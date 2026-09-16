const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

function load(relative, mocks) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const insight = (id = 'generated', historical = false) => ({ id, brandId: 'brand', period: '7d', network: 'all', historical,
  periodStart: '2026-09-08T12:00:00Z', periodEnd: '2026-09-15T12:00:00Z', createdAt: '2026-09-15T12:00:00Z',
  summary: `Résumé ${id}`, importantFacts: [], positivePoints: [], attentionPoints: [], recommendations: [],
  warnings: [], referencedMetrics: [], ai: { status: 'fallback' }, feedback: null,
  metricsSnapshot: { metrics: {}, topPublications: [], lastSyncAt: null } });

function setup(generateInsight = async () => insight()) {
  const votes = [];
  const api = { toUserMessage: (error) => error.message, ApiError: Error, analyticsApi: { generateInsight,
    insightHistory: async () => ({ items: [insight('old', true)], total: 1, page: 1, pageSize: 5 }),
    insightFeedbackStats: async () => ({ total: 0, satisfactionRate: null, mostRejected: [] }),
    insightFeedback: async (brandId, id, useful, comment) => { votes.push({ brandId, id, useful, comment }); return { useful, comment }; },
  } };
  const hooks = load('src/hooks/useAsync.ts', { '@/data/api': api });
  const { AnalyticsInsightPanel } = load('src/components/domain/AnalyticsInsightPanel.tsx', {
    'expo-router': { useRouter: () => ({ push() {} }) },
    'react-native': { StyleSheet: { create: (styles) => styles }, View: 'View' },
    '@/components/ui': new Proxy({}, { get: (_, name) => name }), '@/data/api': api,
    '@/hooks/useAsync': hooks, '@/theme': { spacing: {}, palette: {} },
  });
  // Mirrors the screen's key: changing either brand or filters discards old local state.
  function Screen({ brandId = 'brand', period = '7d', network = 'all', canGenerate = true }) {
    return React.createElement(AnalyticsInsightPanel, { key: `${brandId}:${period}:${network}`, brandId, period, network, canGenerate });
  }
  return { Screen, votes };
}
const button = (renderer, label) => renderer.root.findAllByType('Button').find((item) => item.props.label === label);
const text = (renderer) => JSON.stringify(renderer.toJSON());

test('filter change during generation never displays the previous response', async () => {
  let resolve;
  const scenario = setup(() => new Promise((done) => { resolve = done; }));
  let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  await act(async () => button(renderer, 'Analyser cette période').props.onPress());
  assert.equal(button(renderer, 'Analyser cette période').props.loading, true);
  await act(async () => renderer.update(React.createElement(scenario.Screen, { network: 'instagram' })));
  await act(async () => resolve(insight('stale')));
  assert.ok(!text(renderer).includes('Résumé stale'));
  assert.ok(button(renderer, 'Analyser cette période'));
  await act(async () => renderer.unmount());
});

test('generation, fallback, historical label and feedback use the selected analysis', async () => {
  const scenario = setup(); let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen)); });
  await act(async () => button(renderer, 'Analyser cette période').props.onPress());
  assert.ok(text(renderer).includes('Résumé generated'));
  assert.ok(text(renderer).includes('IA indisponible'));
  assert.ok(button(renderer, 'Régénérer'));
  await act(async () => button(renderer, 'Consulter l’historique').props.onPress());
  const historical = renderer.root.findAllByType('Button').find((item) => item.props.label.includes('Générée le'));
  await act(async () => historical.props.onPress());
  assert.ok(text(renderer).includes('Analyse historique'));
  assert.ok(text(renderer).includes('Résumé old'));
  await act(async () => button(renderer, '👎 Non').props.onPress());
  await act(async () => renderer.root.findByType('TextField').props.onChangeText('À préciser'));
  await act(async () => button(renderer, 'Enregistrer mon avis').props.onPress());
  assert.deepEqual(scenario.votes, [{ brandId: 'brand', id: 'old', useful: false, comment: 'À préciser' }]);
  assert.equal(button(renderer, 'Avis enregistré').props.disabled, true);
  await act(async () => button(renderer, 'Revenir à l’analyse générée').props.onPress());
  assert.ok(text(renderer).includes('Résumé generated'));
  assert.ok(!text(renderer).includes('Analyse historique'));
  await act(async () => renderer.unmount());
});

test('viewer can open history but cannot generate', async () => {
  const scenario = setup(); let renderer;
  await act(async () => { renderer = create(React.createElement(scenario.Screen, { canGenerate: false })); });
  assert.equal(button(renderer, 'Analyser cette période'), undefined);
  assert.ok(button(renderer, 'Consulter l’historique'));
  await act(async () => renderer.unmount());
});
