const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

// Run the real screen and hooks, substituting only native views and IO.
function loadSource(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}

function setup({ conflictSavesDraft = true } = {}) {
  class ApiError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const warning = { code: 'unauthorised_promise', severity: 'blocking', message: 'La réponse engage la marque.' };
  const comment = { id: 'comment', network: 'facebook', authorName: 'Test', authorInitials: 'T', text: 'Ma commande ?', analysis: null,
    response: { id: 'v1', version: 1, text: 'Remboursé sous 5 jours.', originalText: 'Proposition originale', tone: 'professional',
      language: 'fr', blocked: true, warnings: [warning], status: 'proposed' } };
  let current = comment;
  let readCount = 0;
  const submissions = [];
  const api = {
    ApiError, toUserMessage: (error) => error.message,
    brandsApi: { getActive: async () => ({ tone: 'professional', bannedTerms: ['INTERDIT'] }) },
    commentsApi: { get: async () => { readCount++; return current; }, acceptResponse: async (id, text) => {
      submissions.push({ id, text });
      if (submissions.length === 1) {
        if (conflictSavesDraft) current = { ...comment, response: { ...comment.response, id: 'v2', version: 2, text, warnings: [warning] } };
        throw new ApiError('conflict', warning.message);
      }
      assert.equal(id, 'v2', 'Retry uses the version created by the failed approval');
      current = { ...comment, response: { ...current.response, id: 'v3', text, blocked: false, warnings: [], status: 'approved' } };
      return current.response;
    } },
  };
  const ui = new Proxy({ useFeedback: () => ({ toast() {}, confirm: async () => false }),
    networkMeta: { facebook: { label: 'Facebook' } },
    Screen: ({ children, footer }) => React.createElement('Screen', {}, children, footer),
  }, { get: (target, name) => target[name] ?? name });
  const hooks = loadSource('src/hooks/useAsync.ts', { '@/data/api': api });
  const Screen = loadSource('app/comments/[id]/response.tsx', {
    'expo-router': { useRouter: () => ({ back() {}, replace() {} }), useLocalSearchParams: () => ({ id: comment.id }) },
    'react-native': { StyleSheet: { create: (styles) => styles }, View: 'View' },
    '@/components/ui': ui, '@/data/api': api, '@/data/options': { LANGUAGE_OPTIONS: [], TONE_OPTIONS: [] },
    '@/hooks/useAsync': hooks, '@/lib/format': { excerpt: (text) => text }, '@/lib/validation': { messages: {} },
    '@/theme': { palette: {}, spacing: {} },
  }).default;
  return { Screen, submissions, reads: () => readCount, setCurrent: (next) => { current = next; }, comment };
}

test('rapid edits stay stable, a blocked approval refreshes the version, and the next correction succeeds', async () => {
  const scenario = setup();
  let renderer;
  let commits = 0;
  await act(async () => { renderer = create(React.createElement(React.Profiler, { id: 'editor', onRender: () => commits++ }, React.createElement(scenario.Screen))); });
  const field = () => renderer.root.findAllByType('TextField').find((node) => node.props.label === 'Réponse');
  const approve = () => renderer.root.findAllByType('Button').find((node) => node.props.label === 'Valider la modification');
  assert.equal(renderer.root.findAllByType('Button').find((node) => node.props.label === 'Accepter').props.disabled, true);
  const baseline = commits;
  for (let i = 1; i <= 120; i++) await act(async () => field().props.onChangeText('x'.repeat(i)));
  assert.equal(field().props.value.length, 120);
  assert.ok(commits - baseline <= 121, 'Typing must not trigger a second render from derived validation state');
  await act(async () => field().props.onChangeText('Remboursement sous 3 jours.'));
  await act(async () => approve().props.onPress());
  assert.equal(scenario.reads(), 2, '409 refreshes the latest server version');
  assert.equal(field().props.value, 'Remboursement sous 3 jours.');
  assert.ok(renderer.root.findAllByType('Callout').some((node) => node.props.children === 'La réponse engage la marque.'));
  await act(async () => field().props.onChangeText('Bonjour, notre équipe peut vous aider en message privé.'));
  await act(async () => approve().props.onPress());
  assert.equal(scenario.submissions[1].id, 'v2');
  assert.equal(field().props.editable, false);
  assert.ok(renderer.root.findAllByType('Button').some((node) => node.props.label === 'Réponse validée'));
  await act(async () => renderer.unmount());
});

test('a concurrent version refresh preserves a correction which was not saved by the server', async () => {
  const scenario = setup({ conflictSavesDraft: false });
  let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  const field = () => renderer.root.findAllByType('TextField').find((node) => node.props.label === 'Réponse');
  await act(async () => field().props.onChangeText('Ma correction à conserver.'));
  scenario.setCurrent({ ...scenario.comment, response: { ...scenario.comment.response, id: 'other-version', text: 'Autre brouillon.' } });
  await act(async () => renderer.root.findAllByType('Button').find((node) => node.props.label === 'Valider la modification').props.onPress());
  assert.equal(scenario.reads(), 2);
  assert.equal(field().props.value, 'Ma correction à conserver.');
  await act(async () => renderer.unmount());
});

test('a safety conflict displays its precise blocker instead of a generic status message', async () => {
  const savedFetch = global.fetch;
  const savedUrl = process.env.EXPO_PUBLIC_API_URL;
  try {
    process.env.EXPO_PUBLIC_API_URL = 'http://editor.test';
    const api = loadSource('src/data/api.ts', { 'react-native': { Platform: { OS: 'android' } },
      '@/lib/secureStorage': { readToken: async () => 'test-token' } });
    global.fetch = async () => Response.json({ error: { code: 'conflict', message: 'Contrôle de sécurité bloquant.',
      details: [{ severity: 'blocking', message: 'La réponse engage la marque.' }] } }, { status: 409 });
    await assert.rejects(api.commentsApi.acceptResponse('v1', 'Texte corrigé'), (error) => {
      assert.equal(error.code, 'conflict');
      assert.equal(api.toUserMessage(error), 'La réponse engage la marque.');
      return true;
    });
  } finally {
    global.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = savedUrl;
  }
});
