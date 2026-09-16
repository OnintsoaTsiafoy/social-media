import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Isolated fixtures in the Compose PostgreSQL database; every AI call is mocked.
const root = fileURLToPath(new URL('..', import.meta.url));
const tests = fileURLToPath(new URL('../services/api/test', import.meta.url)).replaceAll('\\', '/');
const result = spawnSync('docker', ['compose', 'run', '--rm', '--no-deps', '-e', 'ANALYTICS_INTEGRATION=1',
  '-v', `${tests}:/app/services/api/test:ro`, 'api', 'node', '--test', 'test/analytics-insights.integration.test.js'],
{ cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
