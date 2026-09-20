import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { enqueuePostsSync } from '../lib/jobs.js';
import { callSocialService } from '../lib/socialServiceClient.js';

// Liaison d'un compte utilisateur à une page Facebook par un administrateur de la
// plateforme, depuis la console web.
//
// Seul moyen de lier une page (le mobile n'en propose plus : voir le refus de
// `POST /social-accounts/:provider/connect`). Le compte Facebook qui autorise sur Meta
// gère souvent beaucoup d'autres pages (une agence, plusieurs clients) : rien n'est
// donc lié d'office. Trois temps :
//
//   1. `startPageConnection` — l'administrateur choisit un utilisateur et l'une de
//      ses marques ; on renvoie l'adresse de la boîte de dialogue Meta ;
//   2. Meta → graph-api (callback) → retour sur la console avec l'identifiant d'une
//      SÉLECTION (la liste des pages gérables, jetons chiffrés côté graph-api) ;
//   3. `getPageSelection` puis `linkPageSelection` — l'administrateur choisit les
//      pages à lier, une seule fois.
//
// Les jetons de page ne passent jamais par Express : il ne voit que la liste sans
// jeton renvoyée par graph-api.

const DEFAULT_ADMIN_WEB_URL = 'http://localhost:5173';

/**
 * Adresse où Meta (via graph-api) renvoie l'administrateur : la console, écran des
 * pages. Toujours dérivée de la configuration — jamais d'une valeur du client, qui
 * ferait de la liaison une redirection ouverte.
 */
export function adminWebReturnUrl(env = process.env) {
  const configured = env.ADMIN_WEB_URL?.trim() || DEFAULT_ADMIN_WEB_URL;
  let origin;
  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocole');
    origin = url.origin;
  } catch {
    throw new HttpError(503, 'provider_unavailable', 'L’adresse de la console web (ADMIN_WEB_URL) est invalide.');
  }
  // Routage par hash de la console : graph-api ajoute `?status=…` après le fragment.
  return `${origin}/#/pages`;
}

async function loadEligibleMembership({ userId, brandId }) {
  const membership = await prisma.brandMember.findFirst({
    where: { userId, brandId, brand: { deletedAt: null, status: 'ACTIVE' } },
    include: {
      user: { select: { id: true, displayName: true, status: true } },
      brand: { select: { id: true, name: true } },
    },
  });
  if (!membership || membership.user.status !== 'ACTIVE') {
    throw new HttpError(404, 'not_found', 'Ce compte n’est pas membre actif de cette marque.');
  }
  // Même règle qu'avait le mobile (`requireBrandAccess('ADMIN')`) : seul un propriétaire
  // ou un administrateur de la marque peut y lier une page.
  if (!hasBrandRole(membership.role, 'ADMIN')) {
    throw new HttpError(409, 'conflict', 'Pour lier une page, le compte doit être propriétaire ou administrateur de la marque.');
  }
  return membership;
}

export async function startPageConnection({ userId, brandId }, admin, request) {
  const membership = await loadEligibleMembership({ userId, brandId });

  const result = await callSocialService('/internal/v1/oauth/facebook/authorization-url', {
    scope: 'social:write',
    body: {
      // Le compte utilisateur pour lequel la page est liée (`connected_by_user_id`) ;
      // l'administrateur, lui, est tracé par `initiatedByUserId` et par l'audit.
      userId,
      brandId,
      mobileRedirectUri: adminWebReturnUrl(),
      selectPages: true,
      initiatedByUserId: admin.id,
    },
  });

  await writeAuditLog(prisma, {
    userId: admin.id,
    action: 'admin.page.connect_started',
    resourceType: 'brand',
    resourceId: brandId,
    requestId: request.requestId,
    metadata: { userName: membership.user.displayName, brandName: membership.brand.name, provider: 'facebook' },
  });

  // Le `state` reste côté serveur : le navigateur n'a besoin que de l'adresse Meta.
  return { authorizationUrl: result.authorizationUrl, expiresAt: result.expiresAt };
}

const notFound = () => new HttpError(404, 'not_found', 'Sélection introuvable, expirée ou déjà utilisée.');

/**
 * Pages proposées, enrichies de ce que Meta ne sait pas : à quelle marque une page
 * est DÉJÀ liée (une page ne peut appartenir qu'à une marque à la fois).
 */
export async function getPageSelection(selectionId, admin) {
  const selection = (await callSocialService(`/internal/v1/oauth/selections/${selectionId}`, { method: 'GET', scope: 'social:read' }));

  // Seul l'administrateur qui a lancé la liaison peut la terminer.
  if (selection.initiatedByUserId !== admin.id) throw notFound();

  const facebookIds = selection.pages.map((page) => page.externalId);
  const instagramIds = selection.pages.flatMap((page) => (page.instagram ? [page.instagram.externalId] : []));

  const [user, brand, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: selection.userId }, select: { id: true, displayName: true, email: true } }),
    prisma.brand.findUnique({ where: { id: selection.brandId }, select: { id: true, name: true } }),
    prisma.socialAccount.findMany({
      where: {
        OR: [
          { provider: 'FACEBOOK', externalAccountId: { in: facebookIds } },
          { provider: 'INSTAGRAM', externalAccountId: { in: instagramIds } },
        ],
      },
      include: { brand: { select: { id: true, name: true } } },
    }),
  ]);
  if (!user || !brand) throw notFound();

  const linkedOf = (provider, externalId) => {
    const account = existing.find((entry) => entry.provider === provider && entry.externalAccountId === externalId);
    return account ? { brandId: account.brandId, brandName: account.brand.name, sameBrand: account.brandId === brand.id } : null;
  };

  return {
    id: selection.id,
    expiresAt: selection.expiresAt,
    user: { id: user.id, name: user.displayName, email: user.email },
    brand,
    pages: selection.pages.map((page) => {
      const facebook = linkedOf('FACEBOOK', page.externalId);
      const instagram = page.instagram ? linkedOf('INSTAGRAM', page.instagram.externalId) : null;
      const elsewhere = [facebook, instagram].find((link) => link && !link.sameBrand) ?? null;
      return {
        externalId: page.externalId,
        name: page.name,
        pictureUrl: page.pictureUrl ?? null,
        instagram: page.instagram ? { username: page.instagram.username ?? null, name: page.instagram.name ?? null } : null,
        // Déjà liée à CETTE marque : c'est une reconnexion (jeton renouvelé).
        alreadyLinked: Boolean(facebook?.sameBrand || instagram?.sameBrand),
        // Liée à une AUTRE marque : la lier ici la lui retirerait, avec ses commentaires
        // et publications. Refusé — il faut d'abord la déconnecter de l'autre marque.
        linkedElsewhere: elsewhere ? { brandName: elsewhere.brandName } : null,
      };
    }),
  };
}

/**
 * Lance l'import des publications des comptes qui viennent d'être liés. Facebook
 * seulement : Instagram n'a pas encore de lecture de son fil (graph-api refuse).
 *
 * Au mieux, et sans jamais faire échouer la liaison — elle est déjà faite chez
 * graph-api, et un échec ici (file indisponible) ne doit pas la faire paraître
 * manquée à l'administrateur. Rien n'est perdu : le balayage périodique du worker
 * reprend tout compte dont `last_posts_sync_at` est vide, au plus tard une demi-heure
 * plus tard.
 */
async function queueInitialPostsSync(accounts, admin) {
  await Promise.all(
    accounts
      .filter((account) => account.provider === 'FACEBOOK')
      .map(async (account) => {
        try {
          await enqueuePostsSync({ socialAccountId: account.id, requestedBy: admin.id });
        } catch (error) {
          console.error({ scope: 'posts-sync', action: 'enqueue_after_link', socialAccountId: account.id, error: error?.message });
        }
      })
  );
}

export async function linkPageSelection(selectionId, { pageIds }, admin, request) {
  const selection = await getPageSelection(selectionId, admin);

  const chosen = new Set(pageIds);
  const blocked = selection.pages.filter((page) => chosen.has(page.externalId) && page.linkedElsewhere);
  if (blocked.length > 0) {
    throw new HttpError(
      409,
      'conflict',
      'Une page choisie est déjà liée à une autre marque : déconnectez-la d’abord de cette marque.',
      blocked.map((page) => ({ pageId: page.externalId, name: page.name, brandName: page.linkedElsewhere.brandName }))
    );
  }

  // Le rôle a pu changer entre le départ et le retour de Meta (un quart d'heure au plus).
  await loadEligibleMembership({ userId: selection.user.id, brandId: selection.brand.id });

  const result = await callSocialService(`/internal/v1/oauth/selections/${selectionId}/link`, {
    scope: 'social:write',
    body: { pageIds },
  });

  for (const account of result.accounts) {
    await writeAuditLog(prisma, {
      userId: admin.id,
      action: 'admin.page.connected',
      resourceType: 'social_account',
      resourceId: account.id,
      requestId: request.requestId,
      metadata: {
        userName: selection.user.name,
        brandName: selection.brand.name,
        pageName: account.name,
        provider: account.provider.toLowerCase(),
      },
    });
  }

  // La page est liée : on importe ses publications déjà en ligne (synchronisation
  // initiale), pour que l'application montre des données réelles dès le départ.
  await queueInitialPostsSync(result.accounts, admin);

  return {
    user: selection.user,
    brand: selection.brand,
    accounts: result.accounts.map((account) => ({
      id: account.id,
      network: account.provider.toLowerCase(),
      name: account.name,
      username: account.username ?? null,
    })),
  };
}
