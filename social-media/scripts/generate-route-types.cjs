const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Same generator used by Expo SDK 55's setupTypedRoutes. A fresh filesystem
// scan avoids stale Windows watcher entries such as /knowledge/[id] being
// treated as static paths, and makes typecheck work without starting Metro.
const projectRoot = path.resolve(__dirname, '..');
process.env.EXPO_ROUTER_APP_ROOT = path.join(projectRoot, 'app');
const expoRequire = createRequire(require.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli/package.json'));
const typedRoutes = cliRequire('@expo/router-server/build/typed-routes');
const output = path.join(projectRoot, '.expo', 'types');
fs.mkdirSync(output, { recursive: true });
typedRoutes.regenerateDeclarations(output, {});
