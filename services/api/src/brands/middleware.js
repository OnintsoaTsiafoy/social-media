import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';

const roleRank = {
  VIEWER: 0,
  COMMUNITY_MANAGER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasBrandRole(role, minimumRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

export function requireBrandAccess(minimumRole = 'VIEWER') {
  return async (request, _response, next) => {
    try {
      const membership = await prisma.brandMember.findFirst({
        where: {
          brandId: request.brandId ?? request.params.brandId,
          userId: request.auth.user.id,
          brand: { deletedAt: null, status: 'ACTIVE' },
        },
        include: { brand: true },
      });

      // A missing membership is deliberately a 404: it must not disclose a brand's existence.
      if (!membership) {
        throw new HttpError(404, 'not_found', 'Marque introuvable.');
      }
      if (!hasBrandRole(membership.role, minimumRole)) {
        throw new HttpError(403, 'forbidden', 'Vous n’avez pas les droits suffisants pour cette marque.');
      }

      request.brandAccess = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}
