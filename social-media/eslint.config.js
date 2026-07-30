// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // `.expo` holds generated route types; the handoff folder is design source.
    ignores: ['dist/*', '.expo/*', 'Appli community manager-handoff/*'],
  },
]);
