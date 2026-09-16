import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Isolate environment variables, fetch mocks and Prisma clients between files.
// Importing every file in one process lets health/auth setup race with each other.
const directory = new URL('./', import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith('.test.js')).sort()
  .map((name) => fileURLToPath(new URL(name, directory)));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
