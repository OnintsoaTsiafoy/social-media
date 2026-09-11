import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { publicationIdSchema } from './schemas.js';

const publicationContext = {
  targets: true,
  media: { include: { media: true } },
  schedule: true,
};

/** Vérifie l'appartenance à la marque via le membership de l'utilisateur. */
async function requireMembership(brandId, userId, minimumRole, notFoundMessage) {
  const membership = await prisma.brandMember.findFirst({
    where: { brandId, userId, brand: { deletedAt: null, status: 'ACTIVE' } },
  });

  // Une ressource d'une autre marque retourne 404 : son existence n'est pas divulguée.
  if (!membership) throw new HttpError(404, 'not_found', notFoundMessage);
  if (!hasBrandRole(membership.role, minimumRole)) {
    throw new HttpError(403, 'forbidden', 'Vous n’avez pas les droits suffisants sur cette marque.');
  }
  return membership;
}

/** Charge la publication de l'URL et contrôle le rôle sur sa marque. */
export function loadPublication(minimumRole = 'VIEWER') {
  return async (request, _response, next) => {
    try {
      const parsed = publicationIdSchema.safeParse(request.params.publicationId);
      if (!parsed.success) throw new HttpError(400, 'validation_failed', 'Identifiant de publication invalide.');

      const publication = await prisma.publication.findFirst({
        where: { id: parsed.data, deletedAt: null },
        include: publicationContext,
      });
      if (!publication) throw new HttpError(404, 'not_found', 'Publication introuvable.');

      request.brandAccess = await requireMembership(
        publication.brandId,
        request.auth.user.id,
        minimumRole,
        'Publication introuvable.'
      );
      request.publication = publication;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Contrôle le rôle sur la marque envoyée dans le corps (création). */
export async function requireBrandFromBody(request, brandId, minimumRole) {
  request.brandAccess = await requireMembership(brandId, request.auth.user.id, minimumRole, 'Marque introuvable.');
  return request.brandAccess;
}
