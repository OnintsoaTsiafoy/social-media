const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function loadSource(relative, mocks) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}

function setup(role, initialStatus = 'pending_approval') {
  const calls = [];
  let publication = { id: 'publication', brandId: 'brand', authorId: 'me', status: initialStatus, approvalValid: false,
    approval: initialStatus === 'draft' ? null : { id: 'request-42', status: 'pending', requestedBy: 'me', reviewerName: 'Isa', requesterName: 'Oni', requestedAt: '2026-09-14T12:00:00Z' } };
  const api = { toUserMessage: (error) => error.message, ApiError: Error, approvalsApi: {
    members: async () => [{ id: 'me', displayName: 'Oni', role }, { id: 'reviewer', displayName: 'Isa', role: 'admin' }],
    request: async (id, payload) => { calls.push({ action: 'request', id, payload }); return { ...publication, status: 'pending_approval', approval: { id: 'new-request', status: 'pending' } }; },
    decide: async (id, action, approvalId, comment) => { calls.push({ id, action, approvalId, comment }); return { ...publication, status: 'rejected', approval: { ...publication.approval, status: 'rejected', comment } }; },
  } };
  const ui = new Proxy({ useFeedback: () => ({ toast() {} }) }, { get: (target, name) => target[name] ?? name });
  const hooks = loadSource('src/hooks/useAsync.ts', { '@/data/api': api });
  const { PublicationApprovalPanel } = loadSource('src/components/domain/PublicationApprovalPanel.tsx', {
    'expo-router': { useRouter: () => ({ push() {} }) },
    'react-native': { StyleSheet: { create: (styles) => styles }, View: 'View' },
    '@/components/ui': ui, '@/data/api': api, '@/hooks/useAsync': hooks,
    '@/lib/format': { formatDateTime: (date) => date }, '@/theme': { spacing: {} },
    '@/store/SessionProvider': { useSession: () => ({ user: { id: 'me' }, refreshUnreadCount() {} }) },
  });
  function Screen() {
    const [current, setCurrent] = React.useState(publication);
    return React.createElement(PublicationApprovalPanel, { publication: current, onChange: (next) => { publication = next; setCurrent(next); } });
  }
  return { Screen, calls };
}

test('CM selects a reviewer and sends the optional comment with the draft request', async () => {
  const scenario = setup('community_manager', 'draft');
  let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  await act(async () => renderer.root.findByType('SelectField').props.onChange('reviewer'));
  await act(async () => renderer.root.findByType('TextField').props.onChangeText('  Campagne de septembre  '));
  await act(async () => renderer.root.findAllByType('Button').find((button) => button.props.label === 'Demander une approbation').props.onPress());
  assert.deepEqual(scenario.calls, [{ action: 'request', id: 'publication', payload: { reviewerId: 'reviewer', comment: 'Campagne de septembre' } }]);
  assert.ok(!renderer.root.findAllByType('Button').some((button) => button.props.label === 'Approuver'));
  await act(async () => renderer.unmount());
});

test('reviewer must explain a refusal and the decision targets the displayed request', async () => {
  const scenario = setup('admin');
  let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  const reject = () => renderer.root.findAllByType('Button').find((button) => button.props.label === 'Refuser');
  await act(async () => reject().props.onPress());
  assert.equal(scenario.calls.length, 0);
  assert.ok(renderer.root.findByType('TextField').props.error);
  await act(async () => renderer.root.findByType('TextField').props.onChangeText('Remplacer le visuel.'));
  await act(async () => reject().props.onPress());
  assert.deepEqual(scenario.calls, [{ id: 'publication', action: 'reject', approvalId: 'request-42', comment: 'Remplacer le visuel.' }]);
  assert.ok(renderer.root.findAllByType('Callout').some((node) => node.props.children === 'Remplacer le visuel.'));
  assert.ok(renderer.root.findAllByType('Button').some((node) => node.props.label === 'Modifier et renvoyer'));
  await act(async () => renderer.unmount());
});

test('a viewer sees status and history but cannot submit, decide or cancel', async () => {
  const scenario = setup('viewer');
  let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  assert.deepEqual(renderer.root.findAllByType('Button').map((button) => button.props.label), ['Historique des actions']);
  await act(async () => renderer.unmount());
});

test('approval list and history convert mobile page zero to server page one', async () => {
  const savedFetch = global.fetch, savedUrl = process.env.EXPO_PUBLIC_API_URL;
  const urls = [];
  try {
    process.env.EXPO_PUBLIC_API_URL = 'http://approval.test';
    global.fetch = async (url) => { urls.push(url); return { ok: true, json: async () => ({ data: { items: [], total: 35 } }) }; };
    const { approvalsApi } = loadSource('src/data/api.ts', { 'react-native': { Platform: { OS: 'android' } }, '@/lib/secureStorage': { readToken: async () => 'test' } });
    assert.equal((await approvalsApi.list({ brandId: 'brand' }, 0, 20)).hasMore, true);
    assert.equal((await approvalsApi.list({ brandId: 'brand' }, 1, 20)).hasMore, false);
    assert.equal((await approvalsApi.history('publication', 1)).hasMore, false);
    assert.equal(new URL(urls[0]).searchParams.get('page'), '1');
    assert.equal(new URL(urls[1]).searchParams.get('page'), '2');
    assert.equal(new URL(urls[2]).searchParams.get('page'), '2');
  } finally {
    global.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = savedUrl;
  }
});
