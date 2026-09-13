/**
 * Vérification des JWT de service entrants sur `/internal/v1` (Sprint 11).
 *
 * Jusqu'ici, services/api n'était jamais qu'ÉMETTEUR de ces jetons (voir
 * lib/serviceJwt.js, qui les émet pour appeler graph-api / ai-service).
 * Le worker devient le premier appelant : il persiste déjà lui-même
 * certaines tables en SQL direct (comment_analyses, publications), mais
 * Firebase Admin ne vit que dans Express (Jour 2) — le worker doit donc
 * demander à Express de créer la notification et de pousser, via ce nouveau
 * point d'entrée. Miroir de graph-api/core/security.py::require_service_jwt
 * et de ai-service/core/security.py, mais côté Node.
 */

import jwt from 'jsonwebtoken';

import { HttpError } from './http.js';

// Audience distincte de "social-service"/"ai-service" (émises PAR Express) :
// celle-ci désigne Express comme DESTINATAIRE, émise par le worker.
export const API_SERVICE_AUDIENCE = 'api-service';

function requiredSecret() {
  const value = process.env.SERVICE_JWT_SECRET?.trim();
  if (!value || value.startsWith('change-me')) {
    throw new HttpError(503, 'provider_unavailable', 'Le JWT de service n’est pas configuré.');
  }
  return value;
}

export function requireServiceAuth(requiredScope) {
  return (request, _response, next) => {
    try {
      const authorization = request.get('authorization');
      if (!authorization?.startsWith('Bearer ')) {
        throw new HttpError(401, 'authentication_required', 'En-tête Authorization Bearer requis.');
      }

      let payload;
      try {
        payload = jwt.verify(authorization.slice('Bearer '.length), requiredSecret(), {
          algorithms: ['HS256'],
          audience: API_SERVICE_AUDIENCE,
        });
      } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
          throw new HttpError(401, 'token_expired', 'JWT de service expiré.');
        }
        throw new HttpError(401, 'authentication_required', 'JWT de service invalide.');
      }

      // Un jeton mobile/utilisateur ne doit jamais être accepté ici, même
      // signé avec le même secret dans un environnement mal configuré.
      if (typeof payload === 'string' || payload.type !== 'service') {
        throw new HttpError(401, 'authentication_required', 'Ce jeton n’est pas un JWT de service.');
      }

      const scopes = payload.scope ?? [];
      if (requiredScope && !scopes.includes(requiredScope)) {
        throw new HttpError(403, 'forbidden', `Le jeton ne porte pas le scope requis : ${requiredScope}.`);
      }

      request.service = { subject: payload.sub, scopes };
      next();
    } catch (error) {
      next(error);
    }
  };
}
