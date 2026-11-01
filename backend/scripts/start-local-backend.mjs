import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localBackendEnvironment } from './local-backend-env.mjs';

const check = process.argv.includes('--check');
let child;
let ready = false;
let failure = false;
const stop = () => { if (child && child.exitCode === null) child.kill('SIGTERM'); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8192) throw new Error('Input exceeds limit.');
  }
  const { databaseUrl } = JSON.parse(input);
  input = '';
  const env = localBackendEnvironment(databaseUrl);
  child = fork(fileURLToPath(new URL('../dist/main.js', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, execArgv: [], silent: true
  });
  // Backend exceptions may contain credentials; only allowlisted IPC is displayed.
  child.stdout.resume();
  child.stderr.resume();
  const timeout = setTimeout(() => { failure = true; console.error('FAIL: backend startup timed out'); stop(); }, 30000);
  child.on('message', async message => {
    if (ready || message?.type !== 'local-ready') return;
    ready = true;
    clearTimeout(timeout);
    try {
      if (message.host !== '127.0.0.1' || message.workersEnabled !== 'false') throw new Error();
      const response = await fetch(`http://127.0.0.1:${message.port}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (!response.ok || body.status !== 'ok' || body.database !== 'ok') throw new Error();
      console.log(JSON.stringify({ result: 'PASS', host: message.host, port: message.port, workersEnabled: false, database: 'ok', blockchainKeysProvided: false }));
      if (check) stop();
    } catch {
      failure = true;
      console.error('FAIL: local backend verification');
      stop();
    }
  });
  child.once('error', () => { failure = true; console.error('FAIL: backend process'); });
  child.once('exit', code => {
    clearTimeout(timeout);
    if (!ready) console.error('FAIL: backend exited before ready');
    process.exitCode = failure || !ready || (code !== null && code !== 0) ? 1 : 0;
  });
} catch {
  console.error('FAIL: local launcher configuration');
  process.exitCode = 1;
  stop();
}
