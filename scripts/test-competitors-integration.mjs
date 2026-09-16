import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fixtures isolées dans le PostgreSQL de Compose ; graph-api et ai-service
// sont simulés par le test lui-même — ce parcours porte sur Express et la base
// (unicité, isolation par marque, cascade), pas sur Meta.
const root = fileURLToPath(new URL('..', import.meta.url));
const tests = fileURLToPath(new URL('../services/api/test', import.meta.url)).replaceAll('\\', '/');
const result = spawnSync('docker', ['compose', 'run', '--rm', '--no-deps', '-e', 'COMPETITORS_INTEGRATION=1',
  '-v', `${tests}:/app/services/api/test:ro`, 'api', 'node', '--test', 'test/competitors.integration.test.js'],
{ cwd: root, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
