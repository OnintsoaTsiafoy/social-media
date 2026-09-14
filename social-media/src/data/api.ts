/**
 * In-memory API stand-in.
 *
 * Every call is async and can fail, so screens must implement the loading,
 * error, empty and offline states the specification requires. Swap the bodies
 * for real `fetch` calls - the signatures are the contract screens rely on.
 */

import type { Href } from 'expo-router';
import { Platform } from 'react-native';

import {
  clearSessionTokens,
  readRefreshToken,
  readToken,
  saveRefreshToken,
  saveToken,
} from '@/lib/secureStorage';
import type {
  AiResponse,
  AnalyticsBucket,
  AnalyticsOverview,
  AnalyticsTotals,
  AppNotification,
  Brand,
  Comment,
  CommentStatus,
  DashboardSummary,
  HistoryEvent,
  Intent,
  Language,
  MediaAsset,
  NotificationPreferences,
  Priority,
  Publication,
  PublicationStatus,
  PublicationTarget,
  Sentiment,
  SentimentBreakdown,
  Session,
  SocialAccount,
  SocialNetwork,
  User,
} from '@/types';

/** Thrown for anything the user should see a readable message for. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export type ApiErrorCode =
  | 'offline'
  | 'server'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_credentials'
  | 'account_disabled'
  | 'too_many_attempts'
  | 'email_taken'
  | 'weak_password'
  | 'token_expired'
  | 'ai_unavailable'
  | 'not_found'
  | 'conflict'
  | 'unsupported_media';

/** Human-readable copy. Technical details never reach the user. */
export const errorMessages: Record<ApiErrorCode, string> = {
  offline: 'Aucune connexion Internet. Vérifiez votre réseau puis réessayez.',
  server: 'Le service est momentanément indisponible. Réessayez dans quelques instants.',
  unauthorized: 'Votre session a expiré. Reconnectez-vous pour continuer.',
  invalid_credentials: 'Adresse email ou mot de passe incorrect.',
  account_disabled: 'Ce compte a été désactivé. Contactez le support.',
  too_many_attempts: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  email_taken: 'Cette adresse email est déjà utilisée.',
  weak_password: 'Le mot de passe ne respecte pas les critères de sécurité.',
  token_expired: 'Le compte social doit être reconnecté avant de continuer.',
  ai_unavailable: 'Le service IA est indisponible. Réessayez ou saisissez le texte manuellement.',
  not_found: 'Cet élément n’est plus disponible.',
  conflict: 'Cette action n’est pas autorisée pour le statut actuel.',
  unsupported_media: 'Le fichier sélectionné n’est pas compatible.',
  forbidden: 'Action not permitted for this brand role.',
};

export function toUserMessage(error: unknown): string {
  // Conflict messages are actionable domain errors, including safety blocks.
  if (error instanceof ApiError && error.code === 'conflict') return error.message;
  if (error instanceof ApiError) return errorMessages[error.code];
  return 'Une erreur est survenue. Réessayez.';
}

type ApiEnvelope<T> = { data: T; meta: { requestId: string } };

type RemoteUser = Omit<User, 'avatarInitials'> & { createdAt: string };

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: RemoteUser;
};

type RemoteAiSettings = Partial<
  Pick<Brand, 'tone' | 'customTone' | 'useInformalAddress' | 'emojisAllowed' | 'targetLength' | 'greeting' | 'closing' | 'version'>
> & {
  forbiddenTerms?: string[];
  recommendedTerms?: string[];
  instructions?: string;
  complaintInstructions?: string;
  urgencyInstructions?: string;
  supportInstructions?: string;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');

function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new ApiError('server', 'L’adresse de l’API n’est pas configurée.');
  }
  return `${API_BASE_URL}${path}`;
}

function fromRemoteUser(user: RemoteUser): User {
  return {
    ...user,
    avatarInitials: `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase(),
  };
}

function errorFromResponse(status: number, payload: unknown): ApiError {
  const error = payload as { error?: { code?: string; message?: string; details?: { severity?: string; message?: string }[] } };
  const code = error.error?.code;
  const message = error.error?.message || 'Une erreur est survenue. Réessayez.';

  if (code === 'invalid_credentials') return new ApiError('invalid_credentials', message);
  if (code === 'account_disabled') return new ApiError('account_disabled', message);
  if (code === 'forbidden' || status === 403) return new ApiError('forbidden', message);
  if (code === 'email_taken') return new ApiError('email_taken', message);
  if (code === 'token_expired') return new ApiError('token_expired', message);
  if (code === 'version_conflict') return new ApiError('conflict', message);
  if (code === 'rate_limited' || status === 429) return new ApiError('too_many_attempts', message);
  if (status === 401 || code === 'authentication_required') return new ApiError('unauthorized', message);
  if (status === 404) return new ApiError('not_found', message);
  if (status === 409) {
    const details = Array.isArray(error.error?.details) ? error.error.details : [];
    const blockers = details.filter((detail) => detail.severity === 'blocking' && typeof detail.message === 'string');
    return new ApiError('conflict', blockers.length ? blockers.map((detail) => detail.message).join('\n') : message);
  }
  return new ApiError('server', message);
}

/**
 * Rejoue une seule fois le jeton de session.
 *
 * Partagé par `fetchApi` et par l'upload multipart, qui n'utilise pas `fetch`.
 */
async function refreshAccessToken(): Promise<string> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    await clearSessionTokens();
    throw new ApiError('unauthorized', errorMessages.unauthorized);
  }

  let refreshed: AuthSession;
  try {
    refreshed = await fetchApi<AuthSession>(
      '/api/v1/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      false,
      false
    );
  } catch {
    await clearSessionTokens();
    throw new ApiError('unauthorized', errorMessages.unauthorized);
  }

  await saveToken(refreshed.accessToken);
  await saveRefreshToken(refreshed.refreshToken);
  return refreshed.accessToken;
}

async function fetchApi<T>(
  path: string,
  options: RequestInit = {},
  withAccessToken = false,
  retryAfterRefresh = true
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body) headers.set('content-type', 'application/json');

  if (withAccessToken) {
    const accessToken = await readToken();
    if (!accessToken) throw new ApiError('unauthorized', errorMessages.unauthorized);
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...options, headers });
  } catch {
    throw new ApiError('offline', errorMessages.offline);
  }

  if (response.status === 401 && withAccessToken && retryAfterRefresh) {
    await refreshAccessToken();
    return fetchApi<T>(path, options, true, false);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw errorFromResponse(response.status, payload);
  return (payload as ApiEnvelope<T>).data;
}

// ---------------------------------------------------------------------------
// Simulation controls - a dev affordance so every state can be demonstrated.
// ---------------------------------------------------------------------------

type Simulation = { offline: boolean; failNextRead: boolean; aiUnavailable: boolean };

const simulation: Simulation = { offline: false, failNextRead: false, aiUnavailable: false };

export const devSimulation = {
  get: (): Simulation => ({ ...simulation }),
  setOffline(value: boolean) {
    simulation.offline = value;
  },
  failNextRead() {
    simulation.failNextRead = true;
  },
  setAiUnavailable(value: boolean) {
    simulation.aiUnavailable = value;
  },
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type Credentials = { email: string; password: string };

export type RegistrationPayload = {
  firstName: string;
  lastName: string;
  displayName?: string;
  email: string;
  password: string;
  language: string;
  timezone: string;
};

export const auth = {
  /** Rejects unknown credentials without revealing whether the email exists. */
  async login({ email, password }: Credentials): Promise<{ token: string; refreshToken: string; user: User }> {
    const session = await fetchApi<AuthSession>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return { token: session.accessToken, refreshToken: session.refreshToken, user: fromRemoteUser(session.user) };
  },

  async register(payload: RegistrationPayload): Promise<{ token: string; refreshToken: string; user: User }> {
    const session = await fetchApi<AuthSession>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { token: session.accessToken, refreshToken: session.refreshToken, user: fromRemoteUser(session.user) };
  },

  /** Always resolves: the caller shows a generic message either way. */
  async requestPasswordReset(email: string): Promise<void> {
    await fetchApi('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await fetchApi('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const session = await fetchApi<AuthSession>(
      '/api/v1/auth/change-password',
      { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) },
      true
    );
    await saveToken(session.accessToken);
    await saveRefreshToken(session.refreshToken);
  },

  /** `GET /auth/me` equivalent used by the splash screen. */
  async me(): Promise<{ user: User; brand: Brand | undefined; unreadCount: number }> {
    const data = await fetchApi<{ user: RemoteUser; brand: Brand | null; unreadCount: number }>(
      '/api/v1/auth/me',
      {},
      true
    );
    return { user: fromRemoteUser(data.user), brand: data.brand ?? undefined, unreadCount: data.unreadCount };
  },

  async logout(): Promise<void> {
    await fetchApi('/api/v1/auth/logout', { method: 'POST' }, true);
  },

  /** Désactive le compte côté serveur : annule les publications planifiées et
   * déconnecte les comptes sociaux des marques que l'utilisateur possède seul,
   * puis révoque toutes ses sessions. Refusé (409) si une marque possédée a
   * encore d'autres membres actifs — il faut d'abord les transférer ou les
   * retirer. */
  async deleteAccount(password: string): Promise<void> {
    await fetchApi('/api/v1/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) }, true);
  },
};

// ---------------------------------------------------------------------------
// Profile, brands, sessions
// ---------------------------------------------------------------------------

type RemoteSession = { id: string; device: string; lastActiveAt: string; current: boolean };

/** Le serveur ne fait pas de géolocalisation IP : la localisation, elle,
 * reste indisponible plutôt qu'inventée (même convention que les métriques
 * manquantes, voir README - "Non disponible", jamais une valeur fictive). */
function fromRemoteSession(remote: RemoteSession): Session {
  return { ...remote, location: 'Non disponible' };
}

export const profile = {
  async get(): Promise<User> {
    return fromRemoteUser(await fetchApi<RemoteUser>('/api/v1/profile', {}, true));
  },
  async update(patch: Partial<User>): Promise<User> {
    return fromRemoteUser(
      await fetchApi<RemoteUser>('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(patch) }, true)
    );
  },
  async listSessions(): Promise<Session[]> {
    const remote = await fetchApi<RemoteSession[]>('/api/v1/auth/sessions', {}, true);
    return remote.map(fromRemoteSession);
  },
  async revokeSession(id: string): Promise<void> {
    await fetchApi(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }, true);
  },
  async revokeAllSessions(): Promise<void> {
    await fetchApi('/api/v1/auth/sessions', { method: 'DELETE' }, true);
  },
};

export const brandsApi = {
  async list(): Promise<Brand[]> {
    const result = await fetchApi<{ items: Brand[] }>('/api/v1/brands', {}, true);
    return result.items;
  },
  async create(payload: Pick<Brand, 'name' | 'description' | 'sector' | 'primaryLanguage'>): Promise<Brand> {
    return fetchApi<Brand>(
      '/api/v1/brands',
      {
        method: 'POST',
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          industry: payload.sector,
          primaryLanguage: payload.primaryLanguage,
        }),
      },
      true
    );
  },
  async getActive(): Promise<Brand> {
    const result = await fetchApi<{ items: Brand[] }>('/api/v1/brands?active=true', {}, true);
    const active = result.items[0];
    if (!active) throw new ApiError('not_found', 'No active brand is configured.');
    return active;
  },
  async setActive(id: string): Promise<Brand> {
    return fetchApi<Brand>(`/api/v1/brands/${encodeURIComponent(id)}/activate`, { method: 'POST' }, true);
  },
  async update(id: string, patch: Partial<Brand>): Promise<Brand> {
    const identity = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.sector !== undefined ? { industry: patch.sector } : {}),
      ...(patch.primaryLanguage !== undefined ? { primaryLanguage: patch.primaryLanguage } : {}),
    };
    const brand = Object.keys(identity).length
      ? await fetchApi<Brand>(
          `/api/v1/brands/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(identity) },
          true
        )
      : await fetchApi<Brand>(`/api/v1/brands/${encodeURIComponent(id)}`, {}, true);

    const aiSettings = {
      ...(patch.version !== undefined ? { expectedVersion: patch.version } : {}),
      ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
      ...(patch.customTone !== undefined ? { customTone: patch.customTone } : {}),
      ...(patch.tone === 'formal'
        ? { formality: 'formal' }
        : patch.useInformalAddress !== undefined
        ? { formality: patch.useInformalAddress ? 'informal' : 'adaptive' }
        : {}),
      ...(patch.primaryLanguage !== undefined ? { language: patch.primaryLanguage } : {}),
      ...(patch.emojisAllowed !== undefined ? { emojisAllowed: patch.emojisAllowed } : {}),
      ...(patch.targetLength !== undefined ? { targetLength: patch.targetLength } : {}),
      ...(patch.greeting !== undefined ? { greeting: patch.greeting } : {}),
      ...(patch.closing !== undefined ? { closing: patch.closing } : {}),
      ...(patch.bannedTerms !== undefined ? { forbiddenTerms: patch.bannedTerms } : {}),
      ...(patch.recommendedTerms !== undefined ? { recommendedTerms: patch.recommendedTerms } : {}),
      ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
      ...(patch.complaintInstructions !== undefined ? { complaintInstructions: patch.complaintInstructions } : {}),
      ...(patch.urgencyInstructions !== undefined ? { urgencyInstructions: patch.urgencyInstructions } : {}),
      ...(patch.supportInstructions !== undefined ? { supportInstructions: patch.supportInstructions } : {}),
      ...(patch.escalationRule !== undefined ? { urgencyInstructions: patch.escalationRule } : {}),
    };
    if (!Object.keys(aiSettings).some((key) => key !== 'expectedVersion')) return brand;

    const settings = await fetchApi<RemoteAiSettings>(
      `/api/v1/brands/${encodeURIComponent(id)}/ai-settings`,
      { method: 'PATCH', body: JSON.stringify(aiSettings) },
      true
    );
    return {
      ...brand,
      ...settings,
      bannedTerms: settings.forbiddenTerms ?? brand.bannedTerms,
      escalationRule:
        settings.urgencyInstructions ?? settings.complaintInstructions ?? settings.instructions ?? brand.escalationRule,
    };
  },
};

// ---------------------------------------------------------------------------
// Social accounts (Sprint 06) - real backend, no more fixtures.
// ---------------------------------------------------------------------------

type RemoteSocialAccount = {
  id: string;
  provider: SocialNetwork;
  externalAccountId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: SocialAccount['status'];
  authMethod: 'facebook_page' | 'instagram_login';
  connectedAt: string;
  lastCommentsSyncAt: string | null;
  lastMetricsSyncAt: string | null;
  permissions: { permission: string; granted: boolean }[];
};

/** Meta's raw permission slugs, worded for someone who isn't a developer. */
const PERMISSION_LABELS: Record<string, string> = {
  pages_show_list: 'Lister les pages',
  pages_read_engagement: 'Lire les statistiques d’engagement',
  pages_manage_posts: 'Publier du contenu',
  pages_manage_engagement: 'Répondre aux commentaires',
  business_management: 'Gestion Business Manager',
  instagram_business_basic: 'Profil Instagram',
  instagram_business_content_publish: 'Publier sur Instagram',
  instagram_business_manage_comments: 'Gérer les commentaires Instagram',
  instagram_business_manage_insights: 'Statistiques Instagram',
};

function accountKind(remote: RemoteSocialAccount): string {
  if (remote.provider === 'facebook') return 'Page Facebook';
  return remote.authMethod === 'instagram_login' ? 'Compte Instagram' : 'Compte Instagram lié';
}

function mostRecent(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function fromRemoteAccount(remote: RemoteSocialAccount, brandId: string, brandName: string): SocialAccount {
  return {
    id: remote.id,
    network: remote.provider,
    name: remote.name,
    username: remote.username ?? remote.name,
    externalId: remote.externalAccountId,
    kind: accountKind(remote),
    brandId,
    brandName,
    status: remote.status,
    permissions: remote.permissions.map((permission) => ({
      label: PERMISSION_LABELS[permission.permission] ?? permission.permission,
      granted: permission.granted,
    })),
    connectedAt: remote.connectedAt,
    // Facebook Page tokens don't expire the way a classic OAuth token does
    // (see graph-api/modules/oauth/account_service.py); Express also never
    // reads oauth_tokens directly (graph-api-only, even non-sensitive
    // fields) so there is deliberately nothing to source this from yet.
    tokenExpiresAt: null,
    lastSyncAt: mostRecent(remote.lastCommentsSyncAt, remote.lastMetricsSyncAt),
  };
}

export type OAuthHandoff = { authorizationUrl: string; oauthState: string };

export const accountsApi = {
  async list(brandId: string, brandName: string): Promise<SocialAccount[]> {
    const remote = await fetchApi<RemoteSocialAccount[]>(
      `/api/v1/social-accounts?brandId=${encodeURIComponent(brandId)}`,
      {},
      true
    );
    return remote.map((account) => fromRemoteAccount(account, brandId, brandName));
  },

  /** Revalidates the connection against Meta (catches a silent revocation);
   * there is no comments/metrics sync yet (Sprint 08/12). */
  async sync(id: string, brandId: string, brandName: string): Promise<SocialAccount> {
    const remote = await fetchApi<RemoteSocialAccount>(
      `/api/v1/social-accounts/${id}/sync`,
      { method: 'POST' },
      true
    );
    return fromRemoteAccount(remote, brandId, brandName);
  },

  /** Starts (or restarts) an OAuth round-trip; the account itself only
   * exists once the browser flow completes server-side. */
  async connect(network: SocialNetwork, brandId: string, mobileRedirectUri: string): Promise<OAuthHandoff> {
    return fetchApi<OAuthHandoff>(
      `/api/v1/social-accounts/${network}/connect`,
      { method: 'POST', body: JSON.stringify({ brandId, mobileRedirectUri }) },
      true
    );
  },

  async reconnect(account: SocialAccount, mobileRedirectUri: string): Promise<OAuthHandoff> {
    return accountsApi.connect(account.network, account.brandId, mobileRedirectUri);
  },

  async disconnect(id: string): Promise<void> {
    await fetchApi(`/api/v1/social-accounts/${id}`, { method: 'DELETE' }, true);
  },
};

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export type PublicationFilters = {
  status?: PublicationStatus | 'all';
  network?: SocialNetwork | 'multi' | 'all';
  search?: string;
  withError?: boolean;
  withoutMedia?: boolean;
};

export type PublicationDraft = {
  brandId: string;
  text: string;
  language: string;
  hashtags: string[];
  media: MediaAsset | null;
  networks: SocialNetwork[];
  perNetwork?: Publication['perNetwork'];
};

const PAGE_SIZE = 6;

// --- Contrat serveur ---------------------------------------------------------

type RemoteMedia = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  status: string;
  previewUrl?: string;
  expiresAt?: string;
};

type RemotePublicationTarget = {
  provider: SocialNetwork;
  socialAccountId: string | null;
  /** `null` until the target is linked to a real social_accounts row (Sprint 06). */
  accountUsername: string | null;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  adaptedContent: string | null;
  adaptedHashtags: string[];
  externalPublicationId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  attemptCount: number;
  sentAt: string | null;
};

type RemotePublication = {
  id: string;
  brandId: string;
  brandName: string;
  content: string;
  language: Language;
  hashtags: string[];
  status: PublicationStatus;
  media: RemoteMedia[];
  targets: RemotePublicationTarget[];
  authorName: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  timezone: string;
  metrics: Publication['metrics'];
  commentCount: number;
  negativeCommentCount: number;
  urgentCommentCount: number;
};

function fromRemoteMedia(media: RemoteMedia): MediaAsset {
  return {
    id: media.id,
    fileName: media.fileName,
    mimeType: media.mimeType,
    size: media.size,
    width: media.width ?? 0,
    height: media.height ?? 0,
    // URL signée à durée de vie courte : aucune clé de stockage ne transite.
    uri: media.previewUrl,
    uploadProgress: 1,
  };
}

/** Le modèle mobile ne distingue pas « en cours d’envoi » de « en attente ». */
function fromRemoteTargetStatus(status: RemotePublicationTarget['status']): PublicationTarget['status'] {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function fromRemotePublication(publication: RemotePublication): Publication {
  const perNetwork: Publication['perNetwork'] = {};
  for (const target of publication.targets) {
    if (target.adaptedContent) {
      perNetwork[target.provider] = {
        text: target.adaptedContent,
        hashtags: target.adaptedHashtags ?? [],
      };
    }
  }

  return {
    id: publication.id,
    brandId: publication.brandId,
    brandName: publication.brandName,
    text: publication.content,
    language: publication.language,
    hashtags: publication.hashtags,
    // Périmètre MVP : une image par publication (ADR-08).
    media: publication.media[0] ? fromRemoteMedia(publication.media[0]) : null,
    targets: publication.targets.map((target) => ({
      network: target.provider,
      accountId: target.socialAccountId ?? '',
      accountUsername: target.accountUsername ?? '',
      status: fromRemoteTargetStatus(target.status),
      sentAt: target.sentAt,
      attempts: target.attemptCount,
      externalId: target.externalPublicationId,
      error: target.lastErrorMessage,
    })),
    status: publication.status,
    authorName: publication.authorName,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
    scheduledAt: publication.scheduledAt,
    publishedAt: publication.publishedAt,
    timezone: publication.timezone,
    metrics: publication.metrics,
    commentCount: publication.commentCount,
    negativeCommentCount: publication.negativeCommentCount,
    urgentCommentCount: publication.urgentCommentCount,
    perNetwork: Object.keys(perNetwork).length > 0 ? perNetwork : undefined,
  };
}

function targetsFromDraft(
  networks: SocialNetwork[],
  perNetwork: Publication['perNetwork']
): { provider: SocialNetwork; adaptedContent: string | null; adaptedHashtags: string[] }[] {
  return networks.map((network) => ({
    provider: network,
    adaptedContent: perNetwork?.[network]?.text?.trim() || null,
    adaptedHashtags: perNetwork?.[network]?.hashtags ?? [],
  }));
}

/** Patch accepté par l’écran de modification. */
export type PublicationPatch = Partial<Pick<Publication, 'text' | 'hashtags' | 'media' | 'perNetwork'>> & {
  networks?: SocialNetwork[];
};

/**
 * Publications, médias, planification : appels réels vers l’API Express.
 *
 * L’envoi est asynchrone côté serveur : `publishNow` et `retry` renvoient la
 * publication passée en « publishing », le worker publie ensuite réellement.
 * L’écran doit donc rafraîchir pour voir l’issue, jusqu’au temps réel du
 * Sprint 11.
 */
export const publicationsApi = {
  /** Pagination par index de page, comme l’attend `usePaginatedList`. */
  async list(
    filters: PublicationFilters = {},
    page = 0
  ): Promise<{ items: Publication[]; hasMore: boolean; total: number }> {
    const query = new URLSearchParams({ page: String(page + 1), pageSize: String(PAGE_SIZE) });
    if (filters.status && filters.status !== 'all') query.set('status', filters.status);
    if (filters.search?.trim()) query.set('search', filters.search.trim());
    // « multi » (plusieurs réseaux) n’est pas un filtre serveur : il n’est pas
    // exposé par les écrans actuels.
    if (filters.network && filters.network !== 'all' && filters.network !== 'multi') {
      query.set('provider', filters.network);
    }

    const result = await fetchApi<{
      items: RemotePublication[];
      page: number;
      pageSize: number;
      total: number;
    }>(`/api/v1/publications?${query.toString()}`, {}, true);

    return {
      items: result.items.map(fromRemotePublication),
      hasMore: result.page * result.pageSize < result.total,
      total: result.total,
    };
  },

  async counts(): Promise<Record<'all' | PublicationStatus, number>> {
    return fetchApi<Record<'all' | PublicationStatus, number>>('/api/v1/publications/counts', {}, true);
  },

  async get(id: string): Promise<Publication> {
    return fromRemotePublication(await fetchApi<RemotePublication>(`/api/v1/publications/${id}`, {}, true));
  },

  /** Publications planifiées ou publiées dans le mois affiché. */
  async listForMonth(year: number, month: number): Promise<Publication[]> {
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });

    const result = await fetchApi<{ items: RemotePublication[] }>(
      `/api/v1/calendar?${query.toString()}`,
      {},
      true
    );
    return result.items.map(fromRemotePublication);
  },

  async create(
    draft: PublicationDraft,
    mode: 'draft' | 'publish' | 'schedule',
    scheduledAt?: string
  ): Promise<Publication> {
    if (!draft.text.trim()) throw new ApiError('conflict', 'Le texte de la publication est obligatoire.');
    if (mode !== 'draft' && draft.networks.length === 0) {
      throw new ApiError('conflict', 'Sélectionnez au moins un réseau.');
    }

    const created = await fetchApi<RemotePublication>(
      '/api/v1/publications',
      {
        method: 'POST',
        body: JSON.stringify({
          brandId: draft.brandId,
          content: draft.text.trim(),
          language: draft.language || 'fr',
          hashtags: draft.hashtags,
          mediaIds: draft.media ? [draft.media.id] : [],
          targets: targetsFromDraft(draft.networks, draft.perNetwork),
        }),
      },
      true
    );

    if (mode === 'publish') return publicationsApi.publishNow(created.id);
    if (mode === 'schedule' && scheduledAt) {
      return publicationsApi.schedule(created.id, scheduledAt, created.timezone);
    }
    return fromRemotePublication(created);
  },

  async update(id: string, patch: PublicationPatch): Promise<Publication> {
    const body: Record<string, unknown> = {};
    if (patch.text !== undefined) body.content = patch.text.trim();
    if (patch.hashtags !== undefined) body.hashtags = patch.hashtags;
    if ('media' in patch) body.mediaIds = patch.media ? [patch.media.id] : [];
    if (patch.networks) body.targets = targetsFromDraft(patch.networks, patch.perNetwork);

    return fromRemotePublication(
      await fetchApi<RemotePublication>(
        `/api/v1/publications/${id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
        true
      )
    );
  },

  async schedule(id: string, scheduledAt: string, timezone: string): Promise<Publication> {
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      throw new ApiError('conflict', 'La date et l’heure doivent être dans le futur.');
    }

    return fromRemotePublication(
      await fetchApi<RemotePublication>(
        `/api/v1/publications/${id}/schedule`,
        {
          method: 'POST',
          // Le fuseau de la publication accompagne l’instant absolu, pour réafficher
          // l’heure voulue par le community manager.
          body: JSON.stringify({ scheduledAt, timezone }),
        },
        true
      )
    );
  },

  /** La publication redevient un brouillon : elle reste replanifiable. */
  async cancelSchedule(id: string): Promise<Publication> {
    return fromRemotePublication(
      await fetchApi<RemotePublication>(`/api/v1/publications/${id}/schedule`, { method: 'DELETE' }, true)
    );
  },

  async publishNow(id: string): Promise<Publication> {
    const result = await fetchApi<{ jobId: string | null; publication: RemotePublication }>(
      `/api/v1/publications/${id}/publish`,
      { method: 'POST' },
      true
    );
    return fromRemotePublication(result.publication);
  },

  /** Relance uniquement le réseau demandé, ou tous ceux en échec. */
  async retry(id: string, network?: SocialNetwork): Promise<Publication> {
    const result = await fetchApi<{ jobId: string | null; publication: RemotePublication }>(
      `/api/v1/publications/${id}/retry`,
      { method: 'POST', body: JSON.stringify(network ? { provider: network } : {}) },
      true
    );
    return fromRemotePublication(result.publication);
  },

  async remove(id: string): Promise<void> {
    await fetchApi<void>(`/api/v1/publications/${id}`, { method: 'DELETE' }, true);
  },

  /** Hashtags réels (Sprint 10). `preserve` renvoie en tête ce que
   * l'utilisateur a déjà sélectionné : une régénération ne doit jamais faire
   * disparaître ses ajouts manuels. Les hashtags sont extraits du texte de la
   * publication, donc toujours pertinents mais jamais inventés. */
  async generateHashtags(text: string, brandId: string, preserve: string[] = []): Promise<string[]> {
    if (!text.trim()) return [];
    const result = await fetchApi<{ hashtags: string[]; keywords: string[] }>(
      '/api/v1/publications/generate-hashtags',
      { method: 'POST', body: JSON.stringify({ brandId, text, preserve }) },
      true
    );
    return result.hashtags;
  },

  /** Même appel que `generateHashtags` côté serveur — l'encart « mots-clés
   * détectés » et les propositions viennent de la même extraction, ils ne
   * peuvent donc pas se contredire. */
  async detectKeywords(text: string, brandId: string): Promise<string[]> {
    if (!text.trim()) return [];
    const result = await fetchApi<{ hashtags: string[]; keywords: string[] }>(
      '/api/v1/publications/generate-hashtags',
      { method: 'POST', body: JSON.stringify({ brandId, text }) },
      true
    );
    return result.keywords;
  },
};


// ---------------------------------------------------------------------------
// Médias
// ---------------------------------------------------------------------------

export type UploadCandidate = { uri: string; fileName: string; mimeType: string };

/**
 * Upload multipart réel vers `POST /api/v1/media`.
 *
 * `XMLHttpRequest` est utilisé plutôt que `fetch` pour obtenir la progression
 * d’envoi affichée par l’écran de sélection de média.
 */
async function sendMultipart(
  token: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
  path = '/api/v1/media'
): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const request_ = new XMLHttpRequest();
    request_.open('POST', apiUrl(path));
    request_.setRequestHeader('authorization', `Bearer ${token}`);
    request_.setRequestHeader('accept', 'application/json');

    if (request_.upload) {
      request_.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
    }

    request_.onload = () => {
      let payload: unknown;
      try {
        payload = request_.responseText ? JSON.parse(request_.responseText) : undefined;
      } catch {
        payload = undefined;
      }
      resolve({ status: request_.status, payload });
    };
    request_.onerror = () => reject(new ApiError('offline', errorMessages.offline));
    request_.ontimeout = () => reject(new ApiError('offline', errorMessages.offline));

    request_.send(form);
  });
}

async function buildMediaForm(candidate: UploadCandidate, brandId: string): Promise<FormData> {
  const form = new FormData();

  if (Platform.OS === 'web') {
    // Sur le web, l’URI est un blob local : il faut le matérialiser.
    const blob = await (await fetch(candidate.uri)).blob();
    form.append('file', blob, candidate.fileName);
  } else {
    form.append('file', {
      uri: candidate.uri,
      name: candidate.fileName,
      type: candidate.mimeType,
    } as unknown as Blob);
  }

  form.append('brandId', brandId);
  form.append('purpose', 'publication');
  return form;
}

export const mediaApi = {
  /** Dépose l’image et retourne le média persistant, prêt à être rattaché. */
  async upload(
    candidate: UploadCandidate,
    brandId: string,
    onProgress?: (ratio: number) => void
  ): Promise<MediaAsset> {
    let token = await readToken();
    if (!token) throw new ApiError('unauthorized', errorMessages.unauthorized);

    let response = await sendMultipart(token, await buildMediaForm(candidate, brandId), onProgress);
    if (response.status === 401) {
      // Une seule tentative de rafraîchissement, comme pour les autres appels.
      token = await refreshAccessToken();
      response = await sendMultipart(token, await buildMediaForm(candidate, brandId), onProgress);
    }

    if (response.status !== 201) throw errorFromResponse(response.status, response.payload);
    return fromRemoteMedia((response.payload as ApiEnvelope<RemoteMedia>).data);
  },

  async remove(id: string): Promise<void> {
    await fetchApi<void>(`/api/v1/media/${id}`, { method: 'DELETE' }, true);
  },
};

// ---------------------------------------------------------------------------
// Comments & AI
// ---------------------------------------------------------------------------

export type CommentFilters = {
  status?: CommentStatus | 'all';
  sentiment?: Sentiment | 'all';
  priority?: Priority | 'all';
  intent?: Intent | 'all';
  network?: SocialNetwork | 'all';
  publicationId?: string;
  search?: string;
  sort?: 'recent' | 'priority';
};

export const commentsApi = {
  /** `list`/`counts`/`sync` are brand-scoped server-side (Sprint 08) —
   * `get`/`history`/`setStatus` resolve their brand from the comment's own
   * social account instead, so they don't need it. Depuis le Sprint 09 les
   * filtres d'analyse (sentiment/intention/priorité) sont réellement envoyés :
   * ils portent sur la dernière analyse, donc un commentaire pas encore
   * analysé sort des résultats dès qu'un de ces filtres est posé. */
  async list(filters: CommentFilters = {}, page = 0, brandId = '') {
    const query = new URLSearchParams({ brandId, page: String(page + 1), pageSize: String(PAGE_SIZE) });
    if (filters.status && filters.status !== 'all') query.set('status', filters.status);
    if (filters.network && filters.network !== 'all') query.set('network', filters.network);
    if (filters.publicationId) query.set('publicationId', filters.publicationId);
    if (filters.search?.trim()) query.set('search', filters.search.trim());
    if (filters.sentiment && filters.sentiment !== 'all') query.set('sentiment', filters.sentiment);
    if (filters.intent && filters.intent !== 'all') query.set('intent', filters.intent);
    if (filters.priority && filters.priority !== 'all') query.set('priority', filters.priority);
    if (filters.sort) query.set('sort', filters.sort);

    const result = await fetchApi<{ items: Comment[]; page: number; pageSize: number; total: number }>(
      `/api/v1/comments?${query.toString()}`,
      {},
      true
    );
    return { items: result.items, hasMore: result.page * result.pageSize < result.total, total: result.total };
  },

  async counts(brandId = ''): Promise<{ untreated: number; highPriority: number; pendingAiResponses: number }> {
    return fetchApi(`/api/v1/comments/counts?brandId=${encodeURIComponent(brandId)}`, {}, true);
  },

  async get(id: string): Promise<Comment> {
    return fetchApi<Comment>(`/api/v1/comments/${id}`, {}, true);
  },

  async history(id: string): Promise<HistoryEvent[]> {
    return fetchApi<HistoryEvent[]>(`/api/v1/comments/${id}/history`, {}, true);
  },

  /** The real backfill already runs automatically every 15 minutes
   * server-side — this just triggers the same thing on demand. */
  async sync(brandId: string): Promise<{ imported: number }> {
    const result = await fetchApi<{ syncedAccounts: number }>(
      '/api/v1/comments/sync',
      { method: 'POST', body: JSON.stringify({ brandId }) },
      true
    );
    return { imported: result.syncedAccounts };
  },

  async setStatus(id: string, status: CommentStatus): Promise<Comment> {
    return fetchApi<Comment>(
      `/api/v1/comments/${id}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
      true
    );
  },

  /** Analyse réelle (Sprint 09) : synchrone côté serveur — le modèle est
   * linéaire, pas un LLM, donc la réponse revient assez vite pour que l'écran
   * l'affiche directement. `reanalysis` ne change pas le résultat mais
   * distingue les deux intentions dans l'audit et l'historique. */
  async analyse(id: string, options: { reanalysis?: boolean } = {}): Promise<Comment> {
    return fetchApi<Comment>(
      `/api/v1/comments/${id}/${options.reanalysis ? 'reanalyze' : 'analyze'}`,
      { method: 'POST' },
      true
    );
  },

  /** Génère une proposition (Sprint 10). Chaque appel crée une nouvelle
   * version côté serveur : régénérer n'écrase jamais la proposition
   * précédente, elle reste dans l'historique du commentaire. */
  async generateResponse(
    commentId: string,
    options: { tone: string; language: string; instruction?: string; suggestionId?: string }
  ): Promise<AiResponse> {
    return fetchApi<AiResponse>(
      options.suggestionId ? `/api/v1/ai/responses/${options.suggestionId}/regenerate` : '/api/v1/response-suggestions',
      {
        method: 'POST',
        body: JSON.stringify({
          commentId,
          tone: options.tone,
          language: options.language === 'auto' ? undefined : options.language,
          instruction: options.instruction?.trim() || undefined,
        }),
      },
      true
    );
  },

  /** Enregistre une réécriture humaine. Le serveur crée une version et
   * repasse le texte au contrôle de sécurité — c'est précisément dans une
   * réécriture qu'un engagement non autorisé apparaît le plus souvent.
   * Sans proposition existante, la saisie du community manager en devient
   * une (marquée comme non générée par l'IA). */
  async saveResponse(
    commentId: string,
    text: string,
    patch: Partial<AiResponse> = {},
    suggestionId?: string
  ): Promise<AiResponse> {
    if (!suggestionId) {
      return fetchApi<AiResponse>(
        '/api/v1/response-suggestions',
        {
          method: 'POST',
          body: JSON.stringify({ commentId, text, tone: patch.tone, language: patch.language }),
        },
        true
      );
    }
    return fetchApi<AiResponse>(
      `/api/v1/response-suggestions/${suggestionId}`,
      { method: 'PATCH', body: JSON.stringify({ text, tone: patch.tone, language: patch.language }) },
      true
    );
  },

  async rejectResponse(suggestionId: string, feedback: ResponseFeedback = {}): Promise<void> {
    await fetchApi<AiResponse>(`/api/v1/response-suggestions/${suggestionId}/reject`, { method: 'POST', body: JSON.stringify(feedback) }, true);
  },

  async acceptResponse(suggestionId: string, text: string, feedback: ResponseFeedback = {}): Promise<AiResponse> {
    return fetchApi<AiResponse>(`/api/v1/ai/responses/${suggestionId}/accept`,
      { method: 'POST', body: JSON.stringify({ text, ...feedback }) }, true);
  },

  /** La validation humaine est obligatoire et vérifiée côté serveur : l'envoi
   * refuse toute proposition qui n'a pas été explicitement approuvée, et
   * publie le texte de la version approuvée — pas un texte libre passé à
   * l'envoi, sinon l'approbation ne porterait que sur un brouillon.
   *
   * Deux requêtes, pas une : approuver et envoyer sont deux actes distincts
   * côté serveur (et deux entrées d'audit distinctes). Une ultime retouche
   * est transmise à l'approbation, qui l'enregistre comme une version avant
   * de la valider. */
  async approveAndSend(commentId: string, text: string, suggestionId?: string, feedback: ResponseFeedback = {}): Promise<Comment> {
    let target = suggestionId;
    if (!target) {
      const created = await fetchApi<AiResponse>(
        '/api/v1/response-suggestions',
        { method: 'POST', body: JSON.stringify({ commentId, text }) },
        true
      );
      target = created.id;
    }

    await fetchApi<AiResponse>(
      `/api/v1/response-suggestions/${target}/approve`,
      { method: 'POST', body: JSON.stringify({ text, ...feedback }) },
      true
    );

    return fetchApi<Comment>(`/api/v1/comments/${commentId}/reply`, { method: 'POST' }, true);
  },
};

export type ResponseFeedback = { reason?: string; rating?: number; feedbackComment?: string };
export type KnowledgeDocument = {
  id: string; brandId: string; title: string; documentType: string; content?: string;
  source: string; originalFilename: string | null; internal: boolean;
  status: 'PENDING' | 'INDEXING' | 'READY' | 'FAILED'; revision: number;
  error: string | null; chunkCount: number; indexedAt: string | null;
};
export type KnowledgeInput = { title: string; documentType: string; content: string; internal: boolean };
export type FeedbackStats = {
  generated: number; accepted: number; edited: number; rejected: number; regenerated: number;
  acceptanceRate: number; editRate: number; rejectionRate: number; averageConfidence: number | null;
  averageEditDistance: number | null; averageDurationMs: number | null; averageRating: number | null;
  sentiments: Record<string, number>; intents: Record<string, number>;
};

export const knowledgeApi = {
  list(brandId: string, page = 1): Promise<{ items: KnowledgeDocument[]; page: number; pageSize: number; total: number }> {
    return fetchApi(`/api/v1/knowledge?${new URLSearchParams({ brandId, page: String(page) })}`, {}, true);
  },
  get(id: string): Promise<KnowledgeDocument> {
    return fetchApi(`/api/v1/knowledge/${id}`, {}, true);
  },
  create(brandId: string, input: KnowledgeInput): Promise<KnowledgeDocument> {
    return fetchApi('/api/v1/knowledge', { method: 'POST', body: JSON.stringify({ brandId, ...input }) }, true);
  },
  update(id: string, revision: number, input: KnowledgeInput): Promise<KnowledgeDocument> {
    return fetchApi(`/api/v1/knowledge/${id}`, { method: 'PUT', body: JSON.stringify({ revision, ...input }) }, true);
  },
  reindex(id: string): Promise<KnowledgeDocument> {
    return fetchApi(`/api/v1/knowledge/${id}/reindex`, { method: 'POST' }, true);
  },
  remove(id: string): Promise<void> {
    return fetchApi(`/api/v1/knowledge/${id}`, { method: 'DELETE' }, true);
  },
  async upload(brandId: string, input: Omit<KnowledgeInput, 'content'>,
    file: { uri: string; name: string; mimeType?: string; size?: number }): Promise<KnowledgeDocument> {
    if ((file.size ?? 0) > 10 * 1024 * 1024) throw new ApiError('unsupported_media', 'Fichier trop lourd : maximum 10 Mo.');
    const types: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', csv: 'text/csv' };
    const mimeType = file.mimeType || types[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream';
    const form = new FormData();
    form.append('brandId', brandId);
    form.append('title', input.title);
    form.append('documentType', input.documentType);
    form.append('internal', String(input.internal));
    if (Platform.OS === 'web') form.append('file', new Blob([await (await fetch(file.uri)).blob()], { type: mimeType }), file.name);
    else form.append('file', { uri: file.uri, name: file.name, type: mimeType } as unknown as Blob);
    let token = await readToken();
    if (!token) throw new ApiError('unauthorized', errorMessages.unauthorized);
    let result = await sendMultipart(token, form, undefined, '/api/v1/knowledge/upload');
    if (result.status === 401) {
      token = await refreshAccessToken();
      result = await sendMultipart(token, form, undefined, '/api/v1/knowledge/upload');
    }
    if (result.status !== 201) throw errorFromResponse(result.status, result.payload);
    return (result.payload as ApiEnvelope<KnowledgeDocument>).data;
  },
  stats(brandId: string): Promise<FeedbackStats> {
    return fetchApi(`/api/v1/ai/feedback/stats?${new URLSearchParams({ brandId })}`, {}, true);
  },
};

// ---------------------------------------------------------------------------
// Notifications (Sprint 11 — branché sur l'API réelle et Firebase Cloud
// Messaging ; seule cette façade change, l'écran de notifications et celui
// des préférences n'ont pas été touchés)
// ---------------------------------------------------------------------------

type RemoteNotification = Omit<AppNotification, 'href'> & { href: string };

// Aucun paramètre de pagination ici : l'écran (encore un seul écran, pas de
// pagination infinie) affiche la première page telle quelle, comme le
// faisait la version fixture avec la liste complète.
const NOTIFICATIONS_PAGE_SIZE = 50;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  negativeComment: true,
  urgentComment: true,
  highPriorityComment: true,
  aiResponseGenerated: true,
  publicationPublished: true,
  publicationFailed: true,
  tokenExpiring: true,
  syncFailed: true,
  sound: true,
  vibration: true,
  quietHoursStart: '',
  quietHoursEnd: '',
  minimumPriority: 'low',
};

type RemoteNotificationPreferences = Omit<NotificationPreferences, 'quietHoursStart' | 'quietHoursEnd'> & {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

// L'écran de réglages (non modifié par ce sprint) utilise déjà '' pour « pas
// de plage silencieuse » (voir app/settings/notifications.tsx). Le serveur,
// lui, utilise `null` (voir notification_settings.quiet_hours_start dans
// schema.prisma) : cette conversion vit ici, à la frontière, plutôt que de
// changer l'écran ou le contrat serveur pour l'autre convention.
function fromRemotePreferences(remote: RemoteNotificationPreferences): NotificationPreferences {
  return { ...remote, quietHoursStart: remote.quietHoursStart ?? '', quietHoursEnd: remote.quietHoursEnd ?? '' };
}

function toRemotePreferencesPatch(patch: Partial<NotificationPreferences>): Partial<RemoteNotificationPreferences> {
  return {
    ...patch,
    ...(patch.quietHoursStart !== undefined ? { quietHoursStart: patch.quietHoursStart || null } : {}),
    ...(patch.quietHoursEnd !== undefined ? { quietHoursEnd: patch.quietHoursEnd || null } : {}),
  };
}

export const notificationsApi = {
  async list(filter: 'all' | 'unread' | 'priority' | 'errors' = 'all'): Promise<AppNotification[]> {
    const result = await fetchApi<{ items: RemoteNotification[] }>(
      `/api/v1/notifications?filter=${filter}&pageSize=${NOTIFICATIONS_PAGE_SIZE}`,
      {},
      true
    );
    // `href` est calculé côté serveur (voir notifications/service.js::hrefFor) ;
    // il pointe toujours vers une route réelle de cet arbre de navigation,
    // mais les routes typées d'expo-router ne peuvent pas le vérifier pour
    // une valeur qui vient du réseau — d'où le cast explicite.
    return result.items.map((item) => ({ ...item, href: item.href as Href }));
  },
  async unreadCount(): Promise<number> {
    const result = await fetchApi<{ count: number }>('/api/v1/notifications/unread-count', {}, true);
    return result.count;
  },
  async markRead(id: string): Promise<void> {
    await fetchApi(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }, true);
  },
  async markAllRead(): Promise<void> {
    await fetchApi('/api/v1/notifications/read-all', { method: 'POST' }, true);
  },
  async getPreferences(): Promise<NotificationPreferences> {
    const remote = await fetchApi<RemoteNotificationPreferences>('/api/v1/notification-settings', {}, true);
    return fromRemotePreferences(remote);
  },
  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const remote = await fetchApi<RemoteNotificationPreferences>(
      '/api/v1/notification-settings',
      { method: 'PATCH', body: JSON.stringify(toRemotePreferencesPatch(patch)) },
      true
    );
    return fromRemotePreferences(remote);
  },
  // Pas de point d'entrée dédié côté serveur : réappliquer les valeurs par
  // défaut EST un PATCH comme un autre, la table n'a pas de notion de
  // « jamais réglé » à restaurer.
  async resetPreferences(): Promise<NotificationPreferences> {
    return notificationsApi.updatePreferences(DEFAULT_NOTIFICATION_PREFERENCES);
  },

  /** Enregistre ou renouvelle le token FCM de l'appareil courant. Appelé à la
   * connexion et chaque fois que Firebase signale un nouveau token (voir
   * src/lib/pushNotifications.ts). */
  async registerDeviceToken(token: string, platform: 'android' | 'ios'): Promise<void> {
    await fetchApi(
      '/api/v1/device-tokens',
      { method: 'POST', body: JSON.stringify({ token, platform }) },
      true
    );
  },

  /** Désassocie le token FCM de cet appareil — appelé à la déconnexion, pour
   * qu'un compte différent connecté ensuite sur le même appareil ne reçoive
   * pas les notifications laissées en attente pour l'ancien utilisateur. */
  async removeDeviceToken(token: string): Promise<void> {
    await fetchApi('/api/v1/device-tokens', { method: 'DELETE', body: JSON.stringify({ token }) }, true);
  },
};

// ---------------------------------------------------------------------------
// Dashboard & analytics
// ---------------------------------------------------------------------------

export const dashboardApi = {
  async summary(brandId: string): Promise<DashboardSummary> {
    return fetchApi<DashboardSummary>(`/api/v1/dashboard/summary?brandId=${encodeURIComponent(brandId)}`, {}, true);
  },

  async priorityComments(brandId: string): Promise<Comment[]> {
    return fetchApi<Comment[]>(`/api/v1/dashboard/priority-comments?brandId=${encodeURIComponent(brandId)}`, {}, true);
  },

  async upcomingPublications(brandId: string): Promise<Publication[]> {
    const items = await fetchApi<RemotePublication[]>(
      `/api/v1/dashboard/upcoming-publications?brandId=${encodeURIComponent(brandId)}`,
      {},
      true
    );
    return items.map(fromRemotePublication);
  },
};

type PublicationAnalytics = {
  publication: Publication;
  perNetwork: { network: SocialNetwork; reactions: number | null }[];
  sentiment: SentimentBreakdown;
  urgent: number;
  responsesGenerated: number;
  responsesSent: number;
  unavailable: string[];
};

export const analyticsApi = {
  /** Composeur côté client : les quatre routes /analytics/* (Sprint 12) sont
   * indépendantes côté serveur (jamais de synchronisation lourde déclenchée
   * par une lecture), assemblées ici dans la forme AnalyticsOverview que
   * l'écran attend déjà — reconstituer l'écran autour de 4 appels séparés
   * aurait été une réécriture, pas un branchement. `timeline` ignore
   * volontairement `period` : sa fenêtre est fixée à 4 semaines glissantes
   * côté serveur, cohérente avec le titre statique affiché par l'écran. */
  async overview(brandId: string, period: '7d' | '30d' | '90d' = '30d', network: SocialNetwork | 'all' = 'all'): Promise<AnalyticsOverview> {
    const query = new URLSearchParams({ brandId, period, network });
    const [summary, timeline, topPublications, sentiments] = await Promise.all([
      fetchApi<{ totals: AnalyticsTotals; lastSyncAt: string | null; unavailable: string[] }>(
        `/api/v1/analytics/summary?${query.toString()}`,
        {},
        true
      ),
      fetchApi<{ interactions: AnalyticsBucket[] }>(
        `/api/v1/analytics/timeline?brandId=${encodeURIComponent(brandId)}&network=${network}`,
        {},
        true
      ),
      fetchApi<{ topPublications: RemotePublication[] }>(`/api/v1/analytics/top-publications?${query.toString()}`, {}, true),
      fetchApi<{ sentiment: SentimentBreakdown }>(`/api/v1/analytics/sentiments?${query.toString()}`, {}, true),
    ]);

    return {
      totals: summary.totals,
      interactions: timeline.interactions,
      sentiment: sentiments.sentiment,
      topPublications: topPublications.topPublications.map(fromRemotePublication),
      lastSyncAt: summary.lastSyncAt,
      unavailable: summary.unavailable,
    };
  },

  async forPublication(brandId: string, id: string): Promise<PublicationAnalytics> {
    const data = await fetchApi<Omit<PublicationAnalytics, 'publication'> & { publication: RemotePublication }>(
      `/api/v1/analytics/publications/${encodeURIComponent(id)}?brandId=${encodeURIComponent(brandId)}`,
      {},
      true
    );
    return { ...data, publication: fromRemotePublication(data.publication) };
  },

  /** Déclenche à la demande le même balayage que le cron du worker (Sprint
   * 12) — jamais appelé automatiquement par le dashboard ou l'écran
   * analytics, seulement par une action explicite (pull-to-refresh, bouton). */
  async sync(brandId: string): Promise<{ queued: boolean }> {
    return fetchApi<{ queued: boolean }>(
      '/api/v1/analytics/sync',
      { method: 'POST', body: JSON.stringify({ brandId }) },
      true
    );
  },
};
