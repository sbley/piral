import * as rimraf from 'rimraf';
import { transpileModule, ModuleKind, ModuleResolutionKind, ScriptTarget, JsxEmit } from 'typescript';
import { join, resolve, basename, dirname, extname, isAbsolute, sep } from 'path';
import { exists, mkdir, lstat, unlink, mkdirSync, statSync } from 'fs';
import { writeFile, readFile, readdir, copyFile, constants } from 'fs';
import { log } from './log';
import { deepMerge } from './merge';
import { nodeVersion } from './info';
import { computeHash } from './hash';
import { ForceOverwrite } from './enums';
import { promptConfirm } from './interactive';
import { glob } from '../external';

function promptOverwrite(file: string) {
  const message = `The file ${file} exists already. Do you want to overwrite it?`;
  return promptConfirm(message, false);
}

function createDirectoryLegacy(targetDir: string) {
  const initDir = isAbsolute(targetDir) ? sep : '';

  return targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = resolve(parentDir, childDir);

    try {
      mkdirSync(curDir);
    } catch (err) {
      if (err.code === 'EEXIST') {
        return curDir;
      }

      if (err.code === 'ENOENT') {
        throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
      }

      const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1;

      if (!caughtErr || (caughtErr && curDir === resolve(targetDir))) {
        throw err;
      }
    }

    return curDir;
  }, initDir);
}

function isFile(file: string) {
  return statSync(file).isFile();
}

function isLegacy() {
  const parts = nodeVersion.split('.');
  return +parts[0] < 10 || (+parts[0] === 10 && +parts[1] < 12);
}

export async function removeAny(target: string) {
  const isDir = await checkIsDirectory(target);

  if (isDir) {
    await removeDirectory(target);
  } else {
    await removeFile(target);
  }
}

export function removeDirectory(targetDir: string) {
  log('generalDebug_0003', `Removing the directory "${targetDir}" ...`);
  return new Promise<void>((resolve, reject) => rimraf(targetDir, (err) => (err ? reject(err) : resolve())));
}

export async function createDirectory(targetDir: string) {
  if (isLegacy()) {
    try {
      log('generalDebug_0003', `Trying to create "${targetDir}" in legacy mode ...`);
      createDirectoryLegacy(targetDir);
      return true;
    } catch (e) {
      log('cannotCreateDirectory_0044');
      log('generalDebug_0003', `Error while creating ${targetDir}: ${e}`);
      return false;
    }
  }

  try {
    log('generalDebug_0003', `Trying to create "${targetDir}" in modern mode ...`);
    await new Promise<void>((resolve, reject) => {
      mkdir(targetDir, { recursive: true }, (err) => (err ? reject(err) : resolve()));
    });
    return true;
  } catch (e) {
    log('cannotCreateDirectory_0044');
    log('generalDebug_0003', `Error while creating ${targetDir}: ${e}`);
    return false;
  }
}

export async function getEntryFiles(content: string, basePath: string) {
  log('generalDebug_0003', `Extract entry files from "${basePath}".`);
  const matcher = /<script\s.*?src=(?:"(.*?)"|'(.*?)'|([^\s>]*)).*?>/gi;
  const results: Array<string> = [];
  let result: RegExpExecArray = undefined;

  while ((result = matcher.exec(content))) {
    const src = result[1] || result[2] || result[3];
    log('generalDebug_0003', `Found potential entry file "${src}".`);
    const filePath = resolve(basePath, src);
    const exists = await checkExists(filePath);

    if (exists) {
      results.push(filePath);
    }
  }

  return results;
}

export function checkExists(target: string) {
  return new Promise<boolean>((resolve) => {
    if (target !== undefined) {
      exists(target, resolve);
    } else {
      resolve(false);
    }
  });
}

export async function checkExistingDirectory(target: string) {
  log('generalDebug_0003', `Checking directory "${target}" ...`);

  if (await checkExists(target)) {
    log('generalDebug_0003', `Target exists, but not yet clear if directory.`);
    return await checkIsDirectory(target);
  }

  return false;
}

export function checkIsDirectory(target: string) {
  return new Promise<boolean>((resolve) => {
    lstat(target, (err, stats) => {
      if (err) {
        resolve(extname(target) === '');
      } else {
        resolve(stats.isDirectory());
      }
    });
  });
}

export function getFileNames(target: string) {
  return new Promise<Array<string>>((resolve, reject) => {
    readdir(target, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

export async function findFile(topDir: string, fileName: string): Promise<string> {
  const path = join(topDir, fileName);
  const exists = await checkExists(path);

  if (!exists) {
    const parentDir = resolve(topDir, '..');

    if (parentDir !== topDir) {
      return await findFile(parentDir, fileName);
    }

    return undefined;
  }

  return path;
}

interface AnyPattern {
  original: string;
  patterns: Array<string>;
}

function matchPattern(baseDir: string, pattern: string) {
  return new Promise<Array<string>>((resolve, reject) => {
    glob(
      pattern,
      {
        cwd: baseDir,
        nodir: true,
      },
      (err, files) => {
        if (err) {
          reject(err);
        } else {
          resolve(files);
        }
      },
    );
  });
}

async function matchAnyPattern(baseDir: string, pattern: AnyPattern) {
  const matches = await Promise.all(pattern.patterns.map((pattern) => matchPattern(baseDir, pattern)));

  return {
    pattern: pattern.original,
    results: matches.reduce((agg, curr) => [...agg, ...curr], []),
  };
}

const preferences = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.esm', '.es', '.es6', '.html'];

export async function matchAny(baseDir: string, patterns: Array<string>) {
  const matches: Array<string> = [];
  const exts = preferences.map((s) => s.substr(1)).join(',');
  const allPatterns = patterns.reduce<Array<AnyPattern>>((agg, curr) => {
    const patterns = [];

    if (/[a-zA-Z0-9\-]+$/.test(curr) && !preferences.find((ext) => curr.endsWith(ext))) {
      patterns.push(curr, `${curr}.{${exts}}`, `${curr}/package.json`);
    } else if (curr.endsWith('/')) {
      patterns.push(`${curr}index.{${exts}}`, `${curr}package.json`);
    } else {
      patterns.push(curr);
    }

    agg.push({ original: curr, patterns });
    return agg;
  }, []);

  await Promise.all(
    allPatterns.map((patterns) =>
      matchAnyPattern(baseDir, patterns).then(async ({ results, pattern }) => {
        if (!results.length) {
          //TODO emit warning
        } else {
          log('generalDebug_0003', `Found ${results.length} potential entry points in "${pattern}".`);
          // only take first / primary result
          const firstResult = results[0];
          const fileName = basename(firstResult);

          if (fileName === 'package.json') {
            log('generalDebug_0003', `Entry point is a "package.json" and needs further inspection.`);
            const targetDir = dirname(firstResult);
            const { source } = await readJson(targetDir, fileName);

            if (typeof source === 'string') {
              log('generalDebug_0003', `Found a "source" field with value "${source}".`);
              const target = resolve(targetDir, source);
              const exists = await checkExists(target);

              if (exists) {
                log('generalDebug_0003', `Taking existing target as "${target}".`);
                matches.push(target);
              } else {
                log('generalDebug_0003', `Source target "${target}" does not exist. Skipped.`);
              }
            } else {
              log('generalDebug_0003', `No "source" field found. Trying combinations in "src".`);
              const files = await matchPattern(baseDir, `src/index.{${exts}}`);

              if (files.length > 0) {
                log('generalDebug_0003', `Found a result; taking "${files[0]}".`);
                matches.push(files[0]);
              } else {
                log('generalDebug_0003', `Found no results in "src". Skipped.`);
              }
            }
          } else {
            log('generalDebug_0003', `Entry point result is "${firstResult}".`);
            matches.push(firstResult);
          }
        }
      }),
    ),
  );

  return matches;
}

export function matchFiles(baseDir: string, pattern: string) {
  return new Promise<Array<string>>((resolve, reject) => {
    glob(
      pattern,
      {
        cwd: baseDir,
        absolute: true,
        dot: true,
      },
      (err, files) => {
        if (err) {
          reject(err);
        } else {
          resolve(files.filter(isFile));
        }
      },
    );
  });
}

export async function createFileIfNotExists(
  targetDir: string,
  fileName: string,
  content: Buffer | string,
  forceOverwrite = ForceOverwrite.no,
) {
  const targetFile = join(targetDir, fileName);
  log('generalDebug_0003', `Checking if file "${targetFile}" exists ...`);
  const exists = await checkExists(targetFile);

  if (
    !exists ||
    forceOverwrite === ForceOverwrite.yes ||
    (forceOverwrite === ForceOverwrite.prompt && (await promptOverwrite(targetFile)))
  ) {
    await createDirectory(dirname(targetFile));
    log('generalDebug_0003', `Creating file "${targetFile}" ...`);

    if (typeof content === 'string') {
      await writeText(targetDir, fileName, content);
    } else {
      await writeBinary(targetDir, fileName, content);
    }
  }
}

export async function updateExistingFile(targetDir: string, fileName: string, content: string) {
  const targetFile = join(targetDir, fileName);
  log('generalDebug_0003', `Checking if file "${targetFile}" exists ...`);
  const exists = await checkExists(targetFile);

  if (exists) {
    log('generalDebug_0003', `Updating file "${targetFile}" ...`);
    await new Promise<void>((resolve, reject) => {
      writeFile(targetFile, content, 'utf8', (err) => (err ? reject(err) : resolve()));
    });
  }
}

export async function getHash(targetFile: string) {
  return new Promise<string>((resolve) => {
    readFile(targetFile, (err, c) => (err ? resolve(undefined) : resolve(computeHash(c))));
  });
}

export async function mergeWithJson<T>(targetDir: string, fileName: string, newContent: T) {
  const targetFile = join(targetDir, fileName);
  const content = await new Promise<string>((resolve, reject) => {
    readFile(targetFile, 'utf8', (err, c) => (err ? reject(err) : resolve(c)));
  });
  const originalContent = JSON.parse(content);
  return deepMerge(originalContent, newContent);
}

export async function readJson<T = any>(targetDir: string, fileName: string) {
  const targetFile = join(targetDir, fileName);
  const content = await new Promise<string>((resolve) => {
    readFile(targetFile, 'utf8', (err, c) => (err ? resolve('') : resolve(c)));
  });
  return JSON.parse(content || '{}') as T;
}

export function readBinary(targetDir: string, fileName: string) {
  const targetFile = join(targetDir, fileName);
  return new Promise<Buffer>((resolve) => {
    readFile(targetFile, (err, c) => (err ? resolve(undefined) : resolve(c)));
  });
}

export function readText(targetDir: string, fileName: string) {
  const targetFile = join(targetDir, fileName);
  return new Promise<string>((resolve) => {
    readFile(targetFile, 'utf8', (err, c) => (err ? resolve(undefined) : resolve(c)));
  });
}

export function writeJson<T = any>(targetDir: string, fileName: string, data: T, beautify = false) {
  const content = beautify ? JSON.stringify(data, undefined, 2) : JSON.stringify(data);
  return writeText(targetDir, fileName, content);
}

export function writeText(targetDir: string, fileName: string, content: string) {
  const data = Buffer.from(content, 'utf8');
  return writeBinary(targetDir, fileName, data);
}

export function writeBinary(targetDir: string, fileName: string, data: Buffer) {
  const targetFile = join(targetDir, fileName);
  return new Promise<void>((resolve, reject) => {
    writeFile(targetFile, data, (err) => (err ? reject(err) : resolve()));
  });
}

export async function updateExistingJson<T>(targetDir: string, fileName: string, newContent: T) {
  const content = await mergeWithJson(targetDir, fileName, newContent);
  await updateExistingFile(targetDir, fileName, JSON.stringify(content, undefined, 2));
}

export async function copy(source: string, target: string, forceOverwrite = ForceOverwrite.no): Promise<boolean> {
  await createDirectory(dirname(target));

  try {
    const flag = forceOverwrite === ForceOverwrite.yes ? 0 : constants.COPYFILE_EXCL;
    await new Promise<void>((resolve, reject) => {
      copyFile(source, target, flag, (err) => (err ? reject(err) : resolve()));
    });
    return true;
  } catch (e) {
    if (forceOverwrite === ForceOverwrite.prompt) {
      const shouldOverwrite = await promptOverwrite(target);

      if (shouldOverwrite) {
        return await copy(source, target, ForceOverwrite.yes);
      }
    } else {
      log('didNotOverWriteFile_0045', target);
    }
  }

  return false;
}

/**
 * @deprecated Will be removed with v1. Please use "removeFile".
 */
export function remove(target: string) {
  return removeFile(target);
}

export function removeFile(target: string) {
  return new Promise<void>((resolve, reject) => {
    unlink(target, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export async function move(source: string, target: string, forceOverwrite = ForceOverwrite.no) {
  const dir = await checkIsDirectory(target);

  if (dir) {
    const file = basename(source);
    target = resolve(target, file);
  }

  const success = await copy(source, target, forceOverwrite);

  if (success) {
    await removeFile(source);
    return target;
  }

  return source;
}

export async function getSourceFiles(entry: string) {
  const dir = dirname(entry);
  log('generalDebug_0003', `Trying to get source files from "${dir}" ...`);
  const files = await matchFiles(dir, '**/*.?(jsx|tsx|js|ts)');
  return files.map((path) => {
    const directory = dirname(path);
    const name = basename(path);

    return {
      path,
      directory,
      name,
      async read() {
        const content = await readText(directory, name);

        if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          return transpileModule(content, {
            fileName: path,
            moduleName: name,
            compilerOptions: {
              allowJs: true,
              skipLibCheck: true,
              declaration: false,
              sourceMap: false,
              checkJs: false,
              jsx: JsxEmit.React,
              module: ModuleKind.ESNext,
              moduleResolution: ModuleResolutionKind.NodeJs,
              target: ScriptTarget.ESNext,
            },
          }).outputText;
        }

        return content;
      },
    };
  });
}
