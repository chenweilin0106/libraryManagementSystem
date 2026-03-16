import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    shell: true,
    stdio: 'inherit',
  });
  return child;
}

function waitExit(child, name) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code ?? 'null'}`));
    });
    child.on('error', reject);
  });
}

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  let shuttingDown = false;

  const buildOnce = run('pnpm', ['build'], { cwd });
  await waitExit(buildOnce, 'pnpm build');

  const tscWatch = run('pnpm', ['build:watch'], { cwd });
  const nodeWatch = run('node', ['--watch', 'dist/server.js'], { cwd });

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev] receive ${signal}, shutting down...`);
    for (const child of [nodeWatch, tscWatch]) {
      if (!child.pid) continue;
      child.kill('SIGINT');
    }
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await Promise.race([
      waitExit(tscWatch, 'tsc --watch'),
      waitExit(nodeWatch, 'node --watch'),
    ]);
  } catch (error) {
    if (shuttingDown) return;
    throw error;
  }
}

main().catch((error) => {
  console.error('[dev] failed:', error);
  process.exitCode = 1;
});
