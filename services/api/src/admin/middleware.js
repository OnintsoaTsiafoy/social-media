import { HttpError } from '../lib/http.js';

/**
 * À placer APRÈS `requireAuthentication` : réserve une route aux administrateurs
 * de la plateforme. Contrairement à une marque, l'existence de l'API d'admin
 * n'a rien de secret — un refus est donc un 403 explicite et non un 404.
 *
 * Le rôle vient de la ligne `users` relue à chaque requête par
 * `requireAuthentication` : le retirer (ou suspendre le compte) coupe l'accès
 * immédiatement, sans attendre l'expiration du jeton d'accès.
 */
export function requirePlatformAdmin(request, _response, next) {
  if (request.auth?.user?.platformRole !== 'PLATFORM_ADMIN') {
    next(new HttpError(403, 'forbidden', 'Accès réservé aux administrateurs de la plateforme.'));
    return;
  }
  next();
}
