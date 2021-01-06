import { resolve } from 'path';
import { log } from '../log';
import { runCommand } from '../scripts';
import { MemoryStream } from '../MemoryStream';

function runNxProcess(args: Array<string>, target: string, output?: NodeJS.WritableStream) {
  log('generalDebug_0003', 'Starting the Nx process ...');
  const cwd = resolve(process.cwd(), target);
  return runCommand('nx', args, cwd, output);
}

export async function bootstrap(target = '.', ...flags: Array<string>) {
  const ms = new MemoryStream();
  await runNxProcess(['bootstrap', ...flags], target, ms);
  log('generalDebug_0003', `Nx bootstrap result: ${ms.value}`);
  return ms.value;
}
