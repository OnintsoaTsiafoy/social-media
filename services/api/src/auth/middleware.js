import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { verifyAccessToken } from './tokens.js';

export async function requireAuthentication(request, _response, next) {
  try {
    const authorization = request.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpError(401, 'authentication_required', 'Authentification requise.');
    }

    const { userId, sessionId } = verifyAccessToken(authorization.slice('Bearer '.length));
    const session = await prisma.userSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!session || session.user.status !== 'ACTIVE') {
      throw new HttpError(401, 'authentication_required', 'Session invalide.');
    }

    request.auth = { user: session.user, sessionId: session.id };
    next();
  } catch (error) {
    next(error);
  }
}
