#!/usr/bin/env node
// Platform-aware launcher for the vibe-usage local server.
//
// Preferred: spawn the pre-compiled standalone binary for (platform, arch)
// from dist/. Fallback: run the zero-dependency Node source directly (needs
// Node >= 20 but works on any platform).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const PLATFORM = { darwin: 'darwin', linux: 'linux', win32: 'win32' };
const ARCH = { arm64: 'arm64', x64: 'x64', arm: 'arm64' };
const distName = `vibe-usage-server-${PLATFORM[process.platform]}-${ARCH[process.arch]}`;
const distBin = join(root, 'dist', distName);

if (existsSync(distBin)) {
  const args = process.argv.slice(2);
  const child = spawn(distBin, args, { stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => child.kill(sig));
  }
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
} else {
  // Fallback: run the bundled Node source (zero deps, needs Node >= 20).
  const child = spawn(process.execPath, [join(root, 'index.js'), ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => child.kill(sig));
  }
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}
