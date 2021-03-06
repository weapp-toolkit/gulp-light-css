import through from 'through2';
import gutil from 'gulp-util';
import stream from 'stream';
import globToReg from 'glob-to-regexp';

const PLUGIN_NAME = 'gulp-light-css';
const CSS_IMPORT_REG = /@import\s*['"]([^'"]*)['"];/gm;
const CSS_COMMENT = (index: number) => `css-light${index}{display:block}`;
const CSS_COMMENT_REG = /css-light(\d+)[\s\r\n]*\{[\s\r\n]*display\s*:\s*block;?[\s\r\n]*\}/gm;

type Options = {
  ignores?: string[] /* 忽略的依赖文件名 glob；如 变量、mixin 文件 */;
  notPackIgnoreFiles?: boolean /* 默认 false，是否不打包 ignores 匹配的文件 */;
  compiler: NodeJS.ReadWriteStream | NodeJS.WriteStream;
  ignoreNodeModules?: boolean /* 忽略 node_modules 模块，默认 true */;
  ext?: string /* 替换后缀，默认不替换 */;
};

function shouldIgnore(str: string, reg?: RegExp[], ignoreNodeModules?: boolean) {
  if (!reg) {
    return false;
  }
  if (ignoreNodeModules && isNodeModule(str)) {
    return true;
  }
  return reg.some((r) => r.test(str));
}

function isNodeModule(pathname: string) {
  return /^[@a-zA-Z]/.test(pathname);
}

/**
 *
 * @param options
 *
 *  @property {glob[]} ignores? 忽略的依赖文件，默认忽略前缀为"_"的文件
 *  @property {Stream} compiler `eg. require('gulp-less')()`
 *  @property {boolean} ignoreNodeModules? 忽略 node_modules 模块，默认 true
 *  @property {string} ext? 替换依赖后缀. `default: .css`. `eg. @import './foo.less' -> @import './foo.css'`
 *
 */
function lightcss(options: Options) {
  const _options: Required<Options> = {
    ext: '',
    ignores: ['**/*'],
    ignoreNodeModules: true,
    notPackIgnoreFiles: false,
    ...options,
  };

  const { compiler, ignores, notPackIgnoreFiles, ignoreNodeModules, ext } = _options;
  const ignoreList = ignores.map((p) => globToReg(p));

  if (!compiler) {
    new gutil.PluginError(PLUGIN_NAME, 'Compiler is invalid!');
  }

  return through.obj(function (file, _, cb) {
    if (file.isNull() || (notPackIgnoreFiles && shouldIgnore(file.path, ignoreList, ignoreNodeModules))) {
      return cb();
    }
    if (file.isStream()) {
      cb(new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported.'));
      return;
    }

    /* 如果用注释的方式，可能会被其他插件删除 */
    const importMap: string[] = [];

    /* 删除掉依赖引入 */
    function save(file: any, ignore?: RegExp[], ignoreNodeModules?: boolean) {
      file.contents = Buffer.from(
        String(file.contents).replace(CSS_IMPORT_REG, (substring, match) => {
          /* 是否忽略处理此依赖 */
          if (shouldIgnore(match, ignore, ignoreNodeModules)) {
            return substring;
          }
          const i = importMap.push(substring) - 1;
          return CSS_COMMENT(i);
        })
      );
    }

    /* 重新插入依赖并修改后缀 */
    function restore(file: any, ext: string) {
      file.contents = Buffer.from(
        String(file.contents).replace(CSS_COMMENT_REG, (substring, match) => {
          const origin = importMap[match];
          /* 替换后缀 */
          return ext ? String(origin).replace(/(\.[a-zA-Z0-9]+)(?=['"])/, ext) : origin;
        })
      );
    }

    save(file, ignoreList, ignoreNodeModules);
    // console.log('comment', String(file.contents));

    const s = new stream.Readable();
    s._read = function () {};
    s.push('null');
    s.pipe(
      through.obj(function () {
        this.push(file);
      })
    )
      .pipe(compiler)
      .pipe(
        through.obj((file) => {
          restore(file, ext);
          cb(null, file);
        })
      );
  });
}

export = lightcss;
