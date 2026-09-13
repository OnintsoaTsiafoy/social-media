import { API_SERVICE_AUDIENCE, mintServiceJwt } from './lib/serviceJwt.js';

function baseUrl() {
  const value = process.env.API_SERVICE_URL?.trim();
  if (!value) throw new Error('API_SERVICE_URL est absent.');
  return value;
}

// Un appel par destinataire, volontairement — les producteurs du worker
// (analyse de commentaire, publication, rafraîchissement de token) touchent
// au plus quelques comptes/membres par exécution, pas un volume qui
// justifierait un point d'entrée par lot (voir services/api/src/notifications/
// internal-routes.js). Même contrat que defaultRefreshToken/defaultSyncComments
// ci-dessus : throw sur échec, c'est à l'appelant (une notification par
// membre, dans une boucle) de ne pas laisser un échec isolé interrompre les
// autres destinataires ni le reste du balayage.
export async function defaultNotifyUser(payload) {
  const token = mintServiceJwt(['notifications:write'], API_SERVICE_AUDIENCE);
  const response = await fetch(`${baseUrl()}/internal/v1/notifications`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `notify_failed_${response.status}`);
  }
  return response.json();
}
