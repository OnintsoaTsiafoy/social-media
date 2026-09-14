import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { suggestionIdSchema } from './schemas.js';

/** Charge la proposition de l'URL, son commentaire et son compte social, puis
 * contrôle le rôle sur la marque. Comme pour les commentaires, une ressource
 * d'une autre marque renvoie 404 et non 403 : l'existence d'une proposition
 * étrangère ne doit jamais être divulguée. */
export function loadSuggestion(minimumRole = 'COMMUNITY_MANAGER') {
  return async (request, _response, next) => {
    try {
      const parsed = suggestionIdSchema.safeParse(request.params.suggestionId);
      if (!parsed.success) throw new HttpError(400, 'validation_failed', 'Identifiant de proposition invalide.');

      const suggestion = await prisma.responseSuggestion.findUnique({
        where: { id: parsed.data },
        include: {
          feedback: true,
          comment: {
            include: {
              socialAccount: { select: { id: true, brandId: true, provider: true } },
            },
          },
        },
      });
      if (!suggestion) throw new HttpError(404, 'not_found', 'Proposition introuvable.');

      const membership = await prisma.brandMember.findFirst({
        where: { brandId: suggestion.comment.socialAccount.brandId, userId: request.auth.user.id,
          brand: { deletedAt: null, status: 'ACTIVE' } },
      });
      if (!membership || !hasBrandRole(membership.role, minimumRole)) {
        throw new HttpError(404, 'not_found', 'Proposition introuvable.');
      }

      request.suggestion = suggestion;
      request.comment = suggestion.comment;
      next();
    } catch (error) {
      next(error);
    }
  };
}
