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
  new Function('require', 'module', 'exports', source)(
    (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
    module,
    module.exports
  );
  return module.exports;
}

const card = load('src/components/domain/CompetitorCard.tsx', {
  'react-native': { StyleSheet: { create: (styles) => styles }, View: 'View' },
  '@/components/ui': new Proxy({}, { get: (_, name) => name }),
  '@/lib/format': {
    formatCompactNumber: (value) => `${value}`,
    formatRelative: () => 'il y a 2 heures',
  },
  '@/theme': { palette: {}, spacing: {} },
});

const competitor = (overrides = {}) => ({
  id: 'rival-1',
  brandId: 'brand-1',
  platform: 'instagram',
  externalId: 'ext-1',
  username: 'rival',
  name: 'Rival Brand',
  profileUrl: null,
  avatarUrl: null,
  status: 'active',
  lastSyncedAt: '2026-09-16T08:00:00Z',
  lastErrorCode: null,
  createdAt: '2026-09-01T08:00:00Z',
  latestMetric: null,
  ...overrides,
});

async function render(props) {
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(card.CompetitorRow, { onOpen() {}, ...props }));
  });
  return renderer;
}

const text = (renderer) => JSON.stringify(renderer.toJSON());
const button = (renderer, label) =>
  renderer.root.findAllByType('Button').find((item) => item.props.label === label);

test('un concurrent sans abonnés relevés affiche « non disponible », jamais 0', async () => {
  const renderer = await render({ competitor: competitor() });
  assert.ok(text(renderer).includes('Abonnés : non disponible'));
  assert.ok(!text(renderer).includes('0 abonnés'));
  await act(async () => renderer.unmount());
});

test('un relevé à zéro reste affiché comme zéro, pas comme indisponible', async () => {
  // La règle est « pas de 0 fabriqué », pas « jamais de 0 » : un compteur
  // réellement nul doit rester lisible.
  const renderer = await render({
    competitor: competitor({ latestMetric: { collectedAt: '2026-09-16T08:00:00Z', followersCount: 0, postsCount: null,
      reactionsCount: null, commentsCount: null, sharesCount: null, engagementRate: null } }),
  });
  assert.ok(text(renderer).includes('0 abonnés'));
  await act(async () => renderer.unmount());
});

test('un concurrent inaccessible reste listé, avec l’explication de son statut', async () => {
  const renderer = await render({ competitor: competitor({ status: 'unavailable' }) });
  const rendered = text(renderer);
  assert.ok(rendered.includes('Rival Brand'));
  assert.ok(rendered.includes('Inaccessible'));
  assert.ok(rendered.includes('dernières données connues restent affichées'));
  await act(async () => renderer.unmount());
});

test('une autorisation Meta manquante est distinguée d’une erreur de synchronisation', async () => {
  const pending = await render({ competitor: competitor({ status: 'permission_required' }) });
  assert.ok(text(pending).includes('Autorisation requise'));
  await act(async () => pending.unmount());

  const failing = await render({ competitor: competitor({ status: 'sync_error' }) });
  assert.ok(text(failing).includes('réessaiera automatiquement'));
  await act(async () => failing.unmount());
});

test('un concurrent jamais synchronisé le dit au lieu d’afficher une date vide', async () => {
  const renderer = await render({ competitor: competitor({ lastSyncedAt: null }) });
  assert.ok(text(renderer).includes('Jamais synchronisé'));
  await act(async () => renderer.unmount());
});

test('un VIEWER n’a ni Synchroniser ni Supprimer', async () => {
  const manager = await render({ competitor: competitor(), onSync() {}, onRemove() {} });
  assert.ok(button(manager, 'Synchroniser'));
  assert.ok(button(manager, 'Supprimer'));
  await act(async () => manager.unmount());

  const viewer = await render({ competitor: competitor(), onSync() {}, onRemove() {}, canManage: false });
  assert.equal(button(viewer, 'Synchroniser'), undefined);
  assert.equal(button(viewer, 'Supprimer'), undefined);
  // La lecture reste possible.
  assert.ok(button(viewer, 'Ouvrir'));
  await act(async () => viewer.unmount());
});

test('les quatre statuts du backend ont tous une traduction', () => {
  assert.deepEqual(Object.keys(card.competitorStatusMeta).sort(), [
    'active',
    'permission_required',
    'sync_error',
    'unavailable',
  ]);
  for (const meta of Object.values(card.competitorStatusMeta)) {
    assert.ok(meta.label && meta.hint && meta.tone);
  }
});
