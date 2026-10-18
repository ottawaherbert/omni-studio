import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Repeatable React DOM assertions; use test:script:directory-browser for visual checks.
// The child test runner determines success, including assertion failures and signals.
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const testFile = fileURLToPath(new URL('./script-directory-memory.test.ts', import.meta.url));
const child = spawn(process.execPath, ['--import', 'tsx', '--test', testFile], {
  cwd: repoRoot,
  stdio: 'inherit',
});
const forward = (signal) => { if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
const interrupt = () => forward('SIGINT');
const terminate = () => forward('SIGTERM');
process.on('SIGINT', interrupt);
process.on('SIGTERM', terminate);

try {
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) {
    // Re-raise the child's signal after removing the forwarding handlers.
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = result.code ?? 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', terminate);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
