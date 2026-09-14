import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Use the API's Docker network and database settings. Tests isolate all fixtures
// and queue jobs; the real worker never consumes their jobs, and Meta is mocked.
const root = fileURLToPath(new URL('..', import.meta.url));
const mount = (relative) => `${fileURLToPath(new URL(`../${relative}`, import.meta.url)).replaceAll('\\', '/')}`;
const result = spawnSync('docker', ['compose', 'run', '--rm', '--no-deps', '-e', 'APPROVAL_INTEGRATION=1',
  '-v', `${mount('services/api/test')}:/app/services/api/test:ro`,
  '-v', `${mount('services/worker/src')}:/app/services/worker/src:ro`,
  'api', 'node', '--test', 'test/approvals.integration.test.js'], { cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
