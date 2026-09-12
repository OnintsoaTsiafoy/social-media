import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { commentIdSchema } from './schemas.js';

/** Charge le commentaire de l'URL et contrôle le rôle sur sa marque, via son
 * compte social — un commentaire n'a pas de brandId direct. Une ressource
 * introuvable et une ressource d'une autre marque renvoient toutes deux 404,
 * pour ne jamais divulguer l'existence d'un compte/commentaire étranger
 * (même principe que publications/middleware.js). */
export function loadComment(minimumRole = 'VIEWER') {
  return async (request, _response, next) => {
    try {
      const parsed = commentIdSchema.safeParse(request.params.commentId);
      if (!parsed.success) throw new HttpError(400, 'validation_failed', 'Identifiant de commentaire invalide.');

      const comment = await prisma.socialComment.findUnique({
        where: { id: parsed.data },
        include: { socialAccount: { select: { id: true, brandId: true, name: true, username: true, provider: true } } },
      });
      if (!comment) throw new HttpError(404, 'not_found', 'Commentaire introuvable.');

      const membership = await prisma.brandMember.findFirst({
        where: { brandId: comment.socialAccount.brandId, userId: request.auth.user.id },
      });
      if (!membership || !hasBrandRole(membership.role, minimumRole)) {
        throw new HttpError(404, 'not_found', 'Commentaire introuvable.');
      }

      request.comment = comment;
      next();
    } catch (error) {
      next(error);
    }
  };
}
