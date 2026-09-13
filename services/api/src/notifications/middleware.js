import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { notificationIdSchema } from './schemas.js';

/** Charge la notification de l'URL et vérifie qu'elle appartient à
 * l'utilisateur connecté. Contrairement aux commentaires (accès via le rôle
 * sur la marque), l'appartenance directe (`userId`) EST le contrôle
 * d'accès ici — une notification n'est jamais partagée entre utilisateurs,
 * même sur une marque commune (voir Notification dans schema.prisma : une
 * ligne par destinataire). Une notification d'un autre utilisateur renvoie
 * 404, jamais 403, pour ne pas divulguer son existence. */
export async function loadNotification(request, _response, next) {
  try {
    const parsed = notificationIdSchema.safeParse(request.params.notificationId);
    if (!parsed.success) throw new HttpError(400, 'validation_failed', 'Identifiant de notification invalide.');

    const notification = await prisma.notification.findFirst({
      where: { id: parsed.data, userId: request.auth.user.id },
    });
    if (!notification) throw new HttpError(404, 'not_found', 'Notification introuvable.');

    request.notification = notification;
    next();
  } catch (error) {
    next(error);
  }
}
