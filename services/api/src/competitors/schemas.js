import { z } from 'zod';

const PLATFORMS = ['facebook', 'instagram'];
const STATUSES = ['active', 'unavailable', 'permission_required', 'sync_error'];

export const competitorPeriodSchema = z.enum(['7d', '30d', '90d']).default('30d');
export const competitorPlatformSchema = z.enum(PLATFORMS);
export const competitorPlatformFilterSchema = z.enum([...PLATFORMS, 'all']).default('all');

// Hôtes Meta acceptés dans une URL collée depuis un navigateur ou l'application
// mobile. La liste est fermée volontairement : une URL raccourcie (fb.me,
// l.instagram.com) ne désigne pas de compte lisible sans la suivre, et suivre
// une redirection fournie par l'utilisateur depuis le serveur serait une
// requête sortante arbitraire — refusée plutôt que tentée.
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);

// Segments de chemin qui ne sont jamais un compte.
const FACEBOOK_RESERVED = new Set(['pages', 'profile.php', 'people', 'p', 'groups', 'events', 'watch', 'permalink.php']);

const INSTAGRAM_USERNAME = /^[a-zA-Z0-9._]{1,30}$/;
// Un identifiant de Page est soit numérique, soit un nom de vanité. Meta
// accepte le point et le tiret dans les seconds.
const FACEBOOK_HANDLE = /^[a-zA-Z0-9.\-]{1,100}$/;

class HandleError extends Error {}

function segmentsOf(url) {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Extrait l'identifiant de compte d'une URL de profil ou d'un nom
 * d'utilisateur, et le normalise en minuscules.
 *
 * Fait côté serveur, et avant le moindre appel réseau : une URL qui ne désigne
 * pas un compte doit produire un message clair immédiatement (section 2 du
 * TODO, « Afficher une erreur claire si le compte ne peut pas être analysé »),
 * pas une erreur Meta opaque après un aller-retour.
 *
 * Exporté pour être testé seul — c'est la seule partie de l'ajout d'un
 * concurrent qui soit purement déterministe.
 *
 * @throws {HandleError} message destiné à l'utilisateur.
 */
export function parseCompetitorHandle(platform, rawInput) {
  const input = String(rawInput ?? '').trim();
  if (!input) throw new HandleError('Saisissez une URL de profil ou un nom d’utilisateur.');

  let handle = input;

  if (/^https?:\/\//i.test(input) || /^(www\.|m\.)?(facebook|instagram|fb)\.com\//i.test(input)) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
      throw new HandleError('Cette URL n’est pas valide.');
    }

    const host = url.hostname.toLowerCase();
    const allowed = platform === 'facebook' ? FACEBOOK_HOSTS : INSTAGRAM_HOSTS;
    if (!allowed.has(host)) {
      throw new HandleError(
        platform === 'facebook'
          ? 'Indiquez une URL de Page Facebook (facebook.com/…).'
          : 'Indiquez une URL de profil Instagram (instagram.com/…).'
      );
    }

    const segments = segmentsOf(url);
    if (platform === 'facebook') {
      // facebook.com/profile.php?id=123 et facebook.com/pages/Nom/123 portent
      // l'identifiant ailleurs que dans le premier segment.
      if (segments[0] === 'profile.php') {
        handle = url.searchParams.get('id') ?? '';
      } else if (segments[0] === 'pages' && segments.length >= 3) {
        handle = segments[segments.length - 1];
      } else {
        handle = segments[0] ?? '';
      }
      if (FACEBOOK_RESERVED.has(handle)) handle = '';
    } else {
      handle = segments[0] ?? '';
    }

    if (!handle) throw new HandleError('Cette URL ne désigne pas un compte analysable.');
  }

  handle = handle.replace(/^@/, '').trim().toLowerCase();

  const pattern = platform === 'facebook' ? FACEBOOK_HANDLE : INSTAGRAM_USERNAME;
  if (!pattern.test(handle)) {
    throw new HandleError(
      platform === 'facebook'
        ? 'Nom de Page invalide : lettres, chiffres, points et tirets uniquement.'
        : 'Nom d’utilisateur Instagram invalide : lettres, chiffres, points et tirets bas uniquement.'
    );
  }
  return handle;
}

// Zod porte le message de parseCompetitorHandle jusqu'au `details` de la
// réponse 400, plutôt qu'un « invalide » générique.
const handleField = () => z.string().min(1).max(500);

const handleRefinement = (object, context) => {
  try {
    object.handle = parseCompetitorHandle(object.platform, object.handle);
  } catch (error) {
    context.addIssue({ code: 'custom', path: ['handle'], message: error.message });
  }
  return object;
};

export const competitorBrandSchema = z.object({ brandId: z.uuid() }).strict();

export const verifyCompetitorSchema = z
  .object({ brandId: z.uuid(), platform: competitorPlatformSchema, handle: handleField() })
  .strict()
  .transform(handleRefinement);

export const createCompetitorSchema = verifyCompetitorSchema;

export const listCompetitorsSchema = z.object({
  brandId: z.uuid(),
  platform: competitorPlatformFilterSchema,
  status: z.enum([...STATUSES, 'all']).default('all'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const competitorIdSchema = z.object({ competitorId: z.uuid() });

// Un renommage local uniquement : le nom affiché est réécrit par la prochaine
// synchronisation si Meta en fournit un. `username` reste modifiable parce
// qu'un concurrent peut changer de nom d'utilisateur — c'est la seule façon de
// raccrocher le suivi sans perdre l'historique déjà collecté.
// `handle` n'est pas normalisé ici : il l'est dans le service, avec le réseau
// déjà enregistré du concurrent — le client n'a pas à le répéter, et le
// déduire du corps ouvrirait la porte à un renommage qui change de réseau.
export const updateCompetitorSchema = z
  .object({
    brandId: z.uuid(),
    name: z.string().trim().min(1).max(255).optional(),
    handle: handleField().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.handle !== undefined, {
    message: 'Indiquez au moins un champ à modifier.',
  });

export const competitorPostsQuerySchema = z.object({
  brandId: z.uuid(),
  period: competitorPeriodSchema,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const competitorAnalyticsQuerySchema = z.object({
  brandId: z.uuid(),
  period: competitorPeriodSchema,
});

export const comparisonQuerySchema = z.object({
  brandId: z.uuid(),
  period: competitorPeriodSchema,
  platform: competitorPlatformFilterSchema,
  // Restreindre la comparaison à quelques concurrents : l'écran mobile en
  // affiche peu à la fois, et le payload IA doit rester borné (section 10).
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const explainComparisonSchema = comparisonQuerySchema.strict();
