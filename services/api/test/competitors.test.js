import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averageOf,
  changePercent,
  commonComponents,
  compare,
  computeIndicators,
  interactionsOf,
} from '../src/competitors/indicators.js';
import {
  comparisonQuerySchema,
  competitorPostsQuerySchema,
  createCompetitorSchema,
  listCompetitorsSchema,
  parseCompetitorHandle,
  updateCompetitorSchema,
} from '../src/competitors/schemas.js';

const BRAND_ID = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';

// ---------------------------------------------------------------------------
// Résolution du compte saisi (section 2 : « Résoudre l'identifiant du compte »)
// ---------------------------------------------------------------------------

test('un nom d’utilisateur Instagram est normalisé en minuscules, sans arobase', () => {
  assert.equal(parseCompetitorHandle('instagram', '@Competitor_Brand'), 'competitor_brand');
  assert.equal(parseCompetitorHandle('instagram', '  competitor.brand '), 'competitor.brand');
});

test('une URL de profil Instagram est réduite au nom d’utilisateur', () => {
  assert.equal(parseCompetitorHandle('instagram', 'https://www.instagram.com/competitor.brand/?hl=fr'), 'competitor.brand');
  assert.equal(parseCompetitorHandle('instagram', 'instagram.com/Competitor'), 'competitor');
});

test('les deux formes d’URL de Page Facebook portant un identifiant sont reconnues', () => {
  assert.equal(parseCompetitorHandle('facebook', 'https://facebook.com/profile.php?id=1234567890'), '1234567890');
  assert.equal(parseCompetitorHandle('facebook', 'https://www.facebook.com/pages/Ma-Page/987654321'), '987654321');
  assert.equal(parseCompetitorHandle('facebook', 'm.facebook.com/Studio-Vega'), 'studio-vega');
});

test('une URL d’un autre domaine est refusée avant tout appel réseau', () => {
  assert.throws(() => parseCompetitorHandle('instagram', 'https://twitter.com/brand'), /instagram\.com/);
  // Un hôte Facebook valide reste refusé si le chemin ne désigne pas un compte.
  assert.throws(() => parseCompetitorHandle('facebook', 'https://facebook.com/groups/'), /compte analysable/);
});

test('un nom d’utilisateur Instagram invalide est refusé avec un message exploitable', () => {
  assert.throws(() => parseCompetitorHandle('instagram', 'nom avec espaces'), /tirets bas/);
  assert.throws(() => parseCompetitorHandle('instagram', ''), /URL de profil/);
});

test('le schéma de création normalise le handle et rejette un réseau inconnu', () => {
  const parsed = createCompetitorSchema.parse({ brandId: BRAND_ID, platform: 'instagram', handle: '@Rival' });
  assert.equal(parsed.handle, 'rival');
  assert.throws(() => createCompetitorSchema.parse({ brandId: BRAND_ID, platform: 'twitter', handle: 'x' }));
});

test('le schéma de modification exige au moins un champ et ignore le réseau', () => {
  assert.throws(() => updateCompetitorSchema.parse({ brandId: BRAND_ID }));
  // Le réseau n'est pas modifiable : il est déjà enregistré côté serveur.
  assert.throws(() => updateCompetitorSchema.parse({ brandId: BRAND_ID, name: 'X', platform: 'facebook' }));
  assert.equal(updateCompetitorSchema.parse({ brandId: BRAND_ID, name: 'Rival SA' }).name, 'Rival SA');
});

test('les filtres de liste ont des valeurs par défaut et des bornes', () => {
  const parsed = listCompetitorsSchema.parse({ brandId: BRAND_ID });
  assert.equal(parsed.platform, 'all');
  assert.equal(parsed.status, 'all');
  assert.equal(parsed.pageSize, 20);
  assert.throws(() => listCompetitorsSchema.parse({ brandId: BRAND_ID, status: 'inconnu' }));
});

test('les périodes acceptées sont uniquement 7/30/90 jours', () => {
  assert.equal(competitorPostsQuerySchema.parse({ brandId: BRAND_ID }).period, '30d');
  assert.throws(() => competitorPostsQuerySchema.parse({ brandId: BRAND_ID, period: '13d' }));
  assert.throws(() => comparisonQuerySchema.parse({ brandId: BRAND_ID, limit: 11 }));
});

// ---------------------------------------------------------------------------
// Règle null-vs-zéro (section 11 : « Afficher Donnée non disponible au lieu de 0 »)
// ---------------------------------------------------------------------------

test('une moyenne sans aucune valeur connue est indisponible, pas nulle', () => {
  assert.deepEqual(averageOf([null, null]), { value: null, availability: 'unavailable', sampleSize: 0, total: null });
});

test('une moyenne calculée sur une partie des valeurs est marquée partielle', () => {
  const result = averageOf([10, null, 20]);
  assert.equal(result.value, 15);
  assert.equal(result.availability, 'partial');
  assert.equal(result.sampleSize, 2);
});

test('les interactions d’une publication sans aucun compteur connu valent null, jamais 0', () => {
  assert.equal(interactionsOf({ reactionsCount: null, commentsCount: null, sharesCount: null }), null);
  assert.equal(interactionsOf({ reactionsCount: 3, commentsCount: null, sharesCount: null }), 3);
});

test('un écart sans référence comparable n’est pas fabriqué', () => {
  assert.equal(changePercent(10, 0), null);
  assert.equal(changePercent(10, null), null);
  assert.equal(changePercent(null, 10), null);
  assert.equal(changePercent(12, 10), 20);
});

// ---------------------------------------------------------------------------
// Indicateurs (section 8)
// ---------------------------------------------------------------------------

const FROM = new Date('2026-08-17T00:00:00Z');
const TO = new Date('2026-09-16T00:00:00Z');

function post(iso, reactions, comments, shares = null) {
  return {
    externalPostId: `post-${iso}`,
    publishedAt: iso,
    reactionsCount: reactions,
    commentsCount: comments,
    sharesCount: shares,
    message: 'texte',
    permalink: null,
  };
}

test('la fréquence, les moyennes et le taux d’engagement suivent une seule définition', () => {
  const indicators = computeIndicators({
    posts: [post('2026-09-01T10:00:00Z', 100, 20), post('2026-09-08T10:00:00Z', 200, 40)],
    followersCount: 10_000,
    from: FROM,
    to: TO,
  });

  assert.equal(indicators.postsCount, 2);
  // 2 publications sur ~4,3 semaines.
  assert.equal(indicators.postsPerWeek, 0.5);
  assert.equal(indicators.avgReactions.value, 150);
  assert.equal(indicators.avgComments.value, 30);
  assert.equal(indicators.avgInteractions.value, 180);
  // 180 interactions moyennes / 10 000 abonnés = 1,8 %.
  assert.equal(indicators.engagementRate.value, 1.8);
});

test('sans abonnés connus, le taux d’engagement est indisponible et jamais estimé', () => {
  const indicators = computeIndicators({
    posts: [post('2026-09-01T10:00:00Z', 100, 20)],
    followersCount: null,
    from: FROM,
    to: TO,
  });
  assert.equal(indicators.engagementRate.value, null);
  assert.equal(indicators.engagementRate.availability, 'unavailable');
  assert.ok(indicators.unavailable.includes('followersCount'));
});

test('les partages jamais renseignés sortent des composantes retenues et sont signalés', () => {
  const indicators = computeIndicators({
    posts: [post('2026-09-01T10:00:00Z', 100, 20), post('2026-09-08T10:00:00Z', 200, 40)],
    followersCount: 1000,
    from: FROM,
    to: TO,
  });
  assert.deepEqual(indicators.interactionComponents, ['reactions', 'comments']);
  assert.ok(indicators.unavailable.includes('shares'));
  assert.equal(indicators.avgShares.availability, 'unavailable');
});

test('l’évolution compare la période à la précédente, avec la même formule', () => {
  const indicators = computeIndicators({
    posts: [post('2026-09-01T10:00:00Z', 120, 0)],
    previousPosts: [post('2026-08-01T10:00:00Z', 100, 0)],
    followersCount: 1000,
    from: FROM,
    to: TO,
  });
  assert.equal(indicators.engagementTrend.current, 12);
  assert.equal(indicators.engagementTrend.previous, 10);
  assert.equal(indicators.engagementTrend.changePercent, 20);
});

test('le jour et l’heure les plus fréquents sont lus dans le fuseau demandé', () => {
  // 23h00 UTC un lundi = 1h00 le mardi à Paris : le fuseau change la réponse,
  // ce qui est exactement pourquoi il est explicite.
  const posts = [post('2026-09-07T23:00:00Z', 1, 1), post('2026-09-14T23:00:00Z', 1, 1)];
  const paris = computeIndicators({ posts, followersCount: 100, from: FROM, to: TO, timezone: 'Europe/Paris' });
  const utc = computeIndicators({ posts, followersCount: 100, from: FROM, to: TO, timezone: 'UTC' });

  assert.equal(paris.mostFrequentWeekday.label, 'Mardi');
  assert.equal(paris.mostFrequentHour.label, '01h00');
  assert.equal(utc.mostFrequentWeekday.label, 'Lundi');
  assert.equal(utc.mostFrequentHour.label, '23h00');
});

test('un échantillon faible produit un avertissement, pas un silence', () => {
  const indicators = computeIndicators({ posts: [post('2026-09-01T10:00:00Z', 5, 1)], followersCount: 100, from: FROM, to: TO });
  assert.ok(indicators.warnings.some((warning) => warning.includes('Échantillon limité')));

  const empty = computeIndicators({ posts: [], followersCount: 100, from: FROM, to: TO });
  assert.ok(empty.warnings.some((warning) => warning.includes('Aucune publication')));
  assert.equal(empty.postsPerWeek, 0);
});

// ---------------------------------------------------------------------------
// Comparabilité (section 8 : « Ne pas comparer deux métriques calculées
// différemment »)
// ---------------------------------------------------------------------------

test('seules les composantes présentes des deux côtés sont retenues', () => {
  const brandSide = [post('2026-09-01T10:00:00Z', 10, 2, 4)];
  const competitorSide = [post('2026-09-02T10:00:00Z', 20, 5)];
  assert.deepEqual(commonComponents(brandSide, competitorSide), ['reactions', 'comments']);
});

test('restreindre les composantes change réellement les totaux comparés', () => {
  const posts = [post('2026-09-01T10:00:00Z', 10, 2, 4)];
  const withShares = computeIndicators({ posts, followersCount: 100, from: FROM, to: TO });
  const withoutShares = computeIndicators({
    posts,
    followersCount: 100,
    from: FROM,
    to: TO,
    components: ['reactions', 'comments'],
  });
  assert.equal(withShares.avgInteractions.value, 16);
  assert.equal(withoutShares.avgInteractions.value, 12);
});

test('une métrique manquante d’un côté reste une ligne, marquée indisponible', () => {
  const brand = computeIndicators({ posts: [post('2026-09-01T10:00:00Z', 10, 2, 4)], followersCount: 100, from: FROM, to: TO });
  const competitor = computeIndicators({ posts: [post('2026-09-02T10:00:00Z', 20, 5)], followersCount: null, from: FROM, to: TO });

  const metrics = compare(brand, competitor);
  const byKey = Object.fromEntries(metrics.map((metric) => [metric.key, metric]));

  // La ligne existe toujours — l'écran doit pouvoir écrire « Non disponible ».
  assert.equal(byKey.engagementRate.availability, 'unavailable');
  assert.equal(byKey.engagementRate.differencePercent, null);
  assert.equal(byKey.avgShares.availability, 'unavailable');

  // Une métrique présente des deux côtés reste comparée, orientée marque/concurrent.
  assert.equal(byKey.avgReactions.availability, 'available');
  assert.equal(byKey.avgReactions.brand, 10);
  assert.equal(byKey.avgReactions.competitor, 20);
  assert.equal(byKey.avgReactions.differencePercent, -50);
});
