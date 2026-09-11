/**
 * In-memory API stand-in.
 *
 * Every call is async and can fail, so screens must implement the loading,
 * error, empty and offline states the specification requires. Swap the bodies
 * for real `fetch` calls - the signatures are the contract screens rely on.
 */

import { Platform } from 'react-native';

import * as fixtures from './fixtures';
import {
  clearSessionTokens,
  readRefreshToken,
  readToken,
  saveRefreshToken,
  saveToken,
} from '@/lib/secureStorage';
import type {
  AiResponse,
  AnalyticsOverview,
  AppNotification,
  Brand,
  Comment,
  CommentStatus,
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
  const error = payload as { error?: { code?: string; message?: string } };
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
  if (status === 409) return new ApiError('conflict', message);
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

const LATENCY_MS = 480;

function delay(ms = LATENCY_MS) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Guards every call: rejects when offline, and honours a one-shot failure. */
async function request<T>(produce: () => T, ms = LATENCY_MS): Promise<T> {
  await delay(ms);
  if (simulation.offline) {
    throw new ApiError('offline', errorMessages.offline);
  }
  if (simulation.failNextRead) {
    simulation.failNextRead = false;
    throw new ApiError('server', errorMessages.server);
  }
  return produce();
}

// ---------------------------------------------------------------------------
// Mutable store - cloned from fixtures so edits survive within a session.
// ---------------------------------------------------------------------------

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const store = {
  user: clone(fixtures.currentUser),
  brands: clone(fixtures.brands),
  activeBrandId: fixtures.brands[0]!.id,
  accounts: clone(fixtures.socialAccounts),
  publications: clone(fixtures.publications),
  comments: clone(fixtures.comments),
  history: clone(fixtures.commentHistory),
  notifications: clone(fixtures.notifications),
  analytics: clone(fixtures.analyticsOverview),
  notificationPrefs: clone(fixtures.notificationPreferences),
  sessions: clone(fixtures.sessions),
};

let nextId = 1000;
const makeId = (prefix: string) => `${prefix}_${++nextId}`;

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

  async deleteAccount(password: string): Promise<void> {
    return request(() => {
      if (password === 'wrongpassword') {
        throw new ApiError('invalid_credentials', 'Le mot de passe est incorrect.');
      }
    }, 900);
  },
};

// ---------------------------------------------------------------------------
// Profile, brands, sessions
// ---------------------------------------------------------------------------

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
    return request(() => clone(store.sessions));
  },
  async revokeSession(id: string): Promise<void> {
    return request(() => {
      store.sessions = store.sessions.filter((s) => s.id !== id);
    });
  },
  async revokeAllSessions(): Promise<void> {
    return request(() => {
      store.sessions = store.sessions.filter((s) => s.current);
    }, 700);
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
// Social accounts
// ---------------------------------------------------------------------------

export const accountsApi = {
  async list(): Promise<SocialAccount[]> {
    return request(() => clone(store.accounts));
  },
  async sync(id: string): Promise<SocialAccount> {
    return request(() => {
      const account = store.accounts.find((a) => a.id === id);
      if (!account) throw new ApiError('not_found', errorMessages.not_found);
      if (account.status === 'expired' || account.status === 'reconnect_required') {
        throw new ApiError('token_expired', errorMessages.token_expired);
      }
      account.lastSyncAt = new Date().toISOString();
      return clone(account);
    }, 900);
  },
  async reconnect(id: string): Promise<SocialAccount> {
    return request(() => {
      const account = store.accounts.find((a) => a.id === id);
      if (!account) throw new ApiError('not_found', errorMessages.not_found);
      account.status = 'connected';
      account.tokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString();
      account.lastSyncAt = new Date().toISOString();
      return clone(account);
    }, 1200);
  },
  async connect(network: SocialNetwork): Promise<SocialAccount> {
    return request(() => {
      const account: SocialAccount = {
        id: makeId('acc'),
        network,
        name: network === 'facebook' ? 'Nouvelle page' : 'nouveau.compte',
        username: network === 'facebook' ? '@nouvellepage' : '@nouveau.compte',
        externalId: makeId('ext'),
        kind: network === 'facebook' ? 'Page Facebook' : 'Compte professionnel Instagram',
        brandId: store.activeBrandId,
        brandName: store.brands.find((b) => b.id === store.activeBrandId)?.name ?? '',
        status: 'connected',
        permissions: [
          { label: 'Publier du contenu', granted: true },
          { label: 'Lire les commentaires', granted: true },
          { label: 'Répondre aux commentaires', granted: true },
          { label: 'Statistiques avancées', granted: false },
        ],
        connectedAt: new Date().toISOString(),
        tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
        lastSyncAt: new Date().toISOString(),
      };
      store.accounts.push(account);
      return clone(account);
    }, 1400);
  },
  async disconnect(id: string): Promise<void> {
    return request(() => {
      store.accounts = store.accounts.filter((a) => a.id !== id);
    }, 700);
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
      // Les comptes sociaux liés arrivent au Sprint 06 (OAuth).
      accountId: target.socialAccountId ?? '',
      accountUsername: '',
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
    if (mode === 'schedule' && scheduledAt) return publicationsApi.schedule(created.id, scheduledAt);
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

  async schedule(id: string, scheduledAt: string): Promise<Publication> {
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      throw new ApiError('conflict', 'La date et l’heure doivent être dans le futur.');
    }

    return fromRemotePublication(
      await fetchApi<RemotePublication>(
        `/api/v1/publications/${id}/schedule`,
        {
          method: 'POST',
          // Le fuseau de l’appareil accompagne l’instant absolu, pour réafficher
          // l’heure voulue par le community manager.
          body: JSON.stringify({ scheduledAt, timezone: deviceTimezone() }),
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

  // Hashtags et mots-clés restent simulés : ils arrivent avec LangGraph au Sprint 10.
  async generateHashtags(text: string): Promise<string[]> {
    return request(() => {
      if (simulation.aiUnavailable) throw new ApiError('ai_unavailable', errorMessages.ai_unavailable);
      if (!text.trim()) return [];
      return [...fixtures.suggestedHashtags];
    }, 1100);
  },

  async detectKeywords(text: string): Promise<string[]> {
    return request(() => (text.trim() ? [...fixtures.detectedKeywords] : []), 400);
  },
};

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch {
    return 'Europe/Paris';
  }
}

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
  onProgress?: (ratio: number) => void
): Promise<{ status: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const request_ = new XMLHttpRequest();
    request_.open('POST', apiUrl('/api/v1/media'));
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

const priorityRank = { high: 0, medium: 1, low: 2 } as const;

export const commentsApi = {
  async list(filters: CommentFilters = {}, page = 0) {
    return request(() => {
      let items = [...store.comments];

      if (filters.status && filters.status !== 'all') {
        items = items.filter((c) => c.status === filters.status);
      }
      if (filters.sentiment && filters.sentiment !== 'all') {
        items = items.filter((c) => c.analysis?.sentiment === filters.sentiment);
      }
      if (filters.priority && filters.priority !== 'all') {
        items = items.filter((c) => c.analysis?.priority === filters.priority);
      }
      if (filters.intent && filters.intent !== 'all') {
        items = items.filter((c) => c.analysis?.intent === filters.intent);
      }
      if (filters.network && filters.network !== 'all') {
        items = items.filter((c) => c.network === filters.network);
      }
      if (filters.publicationId) {
        items = items.filter((c) => c.publicationId === filters.publicationId);
      }
      const search = filters.search?.trim().toLowerCase();
      if (search) {
        items = items.filter(
          (c) => c.text.toLowerCase().includes(search) || c.authorName.toLowerCase().includes(search)
        );
      }

      items.sort((a, b) => {
        if (filters.sort === 'priority') {
          const rank =
            priorityRank[a.analysis?.priority ?? 'low'] - priorityRank[b.analysis?.priority ?? 'low'];
          if (rank !== 0) return rank;
        }
        return b.publishedAt.localeCompare(a.publishedAt);
      });

      const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      return { items: clone(pageItems), hasMore: (page + 1) * PAGE_SIZE < items.length, total: items.length };
    });
  },

  async counts(): Promise<{ untreated: number; highPriority: number; pendingAiResponses: number }> {
    return request(
      () => ({
        untreated: store.comments.filter((c) => c.status === 'new' || c.status === 'untreated').length,
        highPriority: store.comments.filter((c) => c.analysis?.priority === 'high').length,
        pendingAiResponses: store.comments.filter((c) => c.response?.status === 'proposed').length,
      }),
      200
    );
  },

  async get(id: string): Promise<Comment> {
    return request(() => {
      const found = store.comments.find((c) => c.id === id);
      if (!found) throw new ApiError('not_found', errorMessages.not_found);
      return clone(found);
    });
  },

  async history(id: string): Promise<HistoryEvent[]> {
    return request(() => clone(store.history[id] ?? []));
  },

  async sync(): Promise<{ imported: number }> {
    return request(() => {
      const expired = store.accounts.find(
        (a) => a.status === 'expired' || a.status === 'reconnect_required'
      );
      if (expired) throw new ApiError('token_expired', errorMessages.token_expired);
      return { imported: 0 };
    }, 1400);
  },

  async setStatus(id: string, status: CommentStatus): Promise<Comment> {
    return request(() => {
      const comment = store.comments.find((c) => c.id === id);
      if (!comment) throw new ApiError('not_found', errorMessages.not_found);
      comment.status = status;
      comment.isNew = false;
      return clone(comment);
    }, 600);
  },

  async analyse(id: string): Promise<Comment> {
    return request(() => {
      if (simulation.aiUnavailable) throw new ApiError('ai_unavailable', errorMessages.ai_unavailable);
      const comment = store.comments.find((c) => c.id === id);
      if (!comment) throw new ApiError('not_found', errorMessages.not_found);
      comment.analysis = {
        sentiment: 'neutral',
        intent: 'question',
        priority: 'medium',
        confidence: 0.84,
        urgent: false,
        sensitive: false,
        recommendedAction: 'Répondre avec l’information demandée.',
        explanation: 'Demande d’information sans marqueur d’insatisfaction.',
        analysedAt: new Date().toISOString(),
        modelVersion: 'v2.1',
      };
      return clone(comment);
    }, 1300);
  },

  async generateResponse(
    id: string,
    options: { tone: string; language: string; instruction?: string }
  ): Promise<AiResponse> {
    return request(() => {
      if (simulation.aiUnavailable) throw new ApiError('ai_unavailable', errorMessages.ai_unavailable);
      const comment = store.comments.find((c) => c.id === id);
      if (!comment) throw new ApiError('not_found', errorMessages.not_found);

      const previous = comment.response;
      const response: AiResponse = {
        id: makeId('rsp'),
        text:
          options.instruction?.trim()
            ? `Bonjour ${comment.authorName.split(' ')[0]}, merci de votre retour. ${options.instruction.trim()} Nous revenons vers vous très vite.`
            : `Bonjour ${comment.authorName.split(' ')[0]}, merci pour votre message. Nous regardons cela et revenons vers vous rapidement.`,
        language: options.language === 'en' ? 'en' : 'fr',
        tone: options.tone as AiResponse['tone'],
        status: 'proposed',
        createdAt: new Date().toISOString(),
        generatedByAi: true,
        originalText: previous?.originalText ?? '',
        version: (previous?.version ?? 0) + 1,
      };
      if (!response.originalText) response.originalText = response.text;
      comment.response = response;
      return clone(response);
    }, 1500);
  },

  /** Saves a human edit without losing the original proposal. */
  async saveResponse(id: string, text: string, patch: Partial<AiResponse> = {}): Promise<AiResponse> {
    return request(() => {
      const comment = store.comments.find((c) => c.id === id);
      if (!comment?.response) throw new ApiError('not_found', errorMessages.not_found);
      comment.response = {
        ...comment.response,
        ...patch,
        text,
        status: 'edited',
        version: comment.response.version + 1,
      };
      return clone(comment.response);
    }, 700);
  },

  async rejectResponse(id: string): Promise<void> {
    return request(() => {
      const comment = store.comments.find((c) => c.id === id);
      if (comment?.response) comment.response.status = 'rejected';
    }, 600);
  },

  /** Human validation is mandatory: nothing is ever sent automatically. */
  async approveAndSend(id: string, text: string): Promise<Comment> {
    return request(() => {
      const comment = store.comments.find((c) => c.id === id);
      if (!comment) throw new ApiError('not_found', errorMessages.not_found);
      if (comment.deletedOnPlatform) {
        throw new ApiError('conflict', 'Ce commentaire a été supprimé sur la plateforme.');
      }
      if (comment.response?.status === 'sent') {
        throw new ApiError('conflict', 'Cette réponse a déjà été envoyée.');
      }
      const account = store.accounts.find((a) => a.network === comment.network);
      if (!account || account.status === 'expired' || account.status === 'reconnect_required') {
        throw new ApiError('token_expired', errorMessages.token_expired);
      }
      comment.response = {
        ...(comment.response ?? {
          id: makeId('rsp'),
          language: 'fr',
          tone: 'friendly',
          createdAt: new Date().toISOString(),
          generatedByAi: true,
          originalText: text,
          version: 1,
        }),
        text,
        status: 'sent',
      };
      comment.status = 'treated';
      return clone(comment);
    }, 1400);
  },
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationsApi = {
  async list(filter: 'all' | 'unread' | 'priority' | 'errors' = 'all'): Promise<AppNotification[]> {
    return request(() => {
      let items = [...store.notifications];
      if (filter === 'unread') items = items.filter((n) => !n.read);
      if (filter === 'priority') items = items.filter((n) => n.priority === 'high');
      if (filter === 'errors') {
        items = items.filter((n) =>
          ['publication_failed', 'sync_failed', 'token_expired', 'token_expiring', 'account_disconnected'].includes(
            n.type
          )
        );
      }
      return clone(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
  },
  async unreadCount(): Promise<number> {
    return request(() => store.notifications.filter((n) => !n.read).length, 200);
  },
  async markRead(id: string): Promise<void> {
    return request(() => {
      const notification = store.notifications.find((n) => n.id === id);
      if (notification) notification.read = true;
    }, 300);
  },
  async markAllRead(): Promise<void> {
    return request(() => {
      store.notifications = store.notifications.map((n) => ({ ...n, read: true }));
    }, 500);
  },
  async getPreferences(): Promise<NotificationPreferences> {
    return request(() => clone(store.notificationPrefs));
  },
  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    return request(() => {
      store.notificationPrefs = { ...store.notificationPrefs, ...patch };
      return clone(store.notificationPrefs);
    }, 500);
  },
  async resetPreferences(): Promise<NotificationPreferences> {
    return request(() => {
      store.notificationPrefs = clone(fixtures.notificationPreferences);
      return clone(store.notificationPrefs);
    }, 500);
  },
};

// ---------------------------------------------------------------------------
// Dashboard & analytics
// ---------------------------------------------------------------------------

export const dashboardApi = {
  async summary() {
    return request(() => ({
      scheduledCount: store.publications.filter((p) => p.status === 'scheduled').length,
      newCommentCount: store.comments.filter((c) => c.isNew || c.status === 'untreated').length,
      highPriorityCount: store.comments.filter((c) => c.analysis?.priority === 'high').length,
      pendingAiResponseCount: store.comments.filter((c) => c.response?.status === 'proposed').length,
    }), 400);
  },

  async priorityComments(): Promise<Comment[]> {
    return request(() =>
      clone(
        store.comments
          .filter((c) => c.analysis?.priority === 'high' && c.status !== 'treated' && c.status !== 'ignored')
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, 3)
      )
    );
  },

  async upcomingPublications(): Promise<Publication[]> {
    return request(() =>
      clone(
        store.publications
          .filter((p) => p.status === 'scheduled' && p.scheduledAt)
          .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
          .slice(0, 3)
      )
    );
  },
};

export const analyticsApi = {
  async overview(_period: '7d' | '30d' | '90d' = '30d'): Promise<AnalyticsOverview> {
    return request(() => {
      const top = [...store.publications]
        .filter((p) => p.metrics.engagementRate !== null)
        .sort((a, b) => (b.metrics.engagementRate ?? 0) - (a.metrics.engagementRate ?? 0))
        .slice(0, 3);
      return clone({ ...store.analytics, topPublications: top });
    }, 800);
  },

  async forPublication(id: string) {
    return request(() => {
      const publication = store.publications.find((p) => p.id === id);
      if (!publication) throw new ApiError('not_found', errorMessages.not_found);
      const related = store.comments.filter((c) => c.publicationId === id);
      return clone({
        publication,
        perNetwork: publication.targets.map((target) => ({
          network: target.network,
          reactions:
            target.status === 'sent'
              ? Math.round((publication.metrics.reactions ?? 0) * (target.network === 'facebook' ? 0.67 : 0.33))
              : null,
        })),
        sentiment: {
          positive: related.filter((c) => c.analysis?.sentiment === 'positive').length,
          neutral: related.filter((c) => c.analysis?.sentiment === 'neutral').length,
          negative: related.filter((c) => c.analysis?.sentiment === 'negative').length,
        },
        urgent: related.filter((c) => c.analysis?.urgent).length,
        responsesGenerated: related.filter((c) => c.response).length,
        responsesSent: related.filter((c) => c.response?.status === 'sent').length,
        unavailable:
          publication.metrics.impressions === null ? ['Impressions Instagram'] : ([] as string[]),
      });
    }, 800);
  },
};
