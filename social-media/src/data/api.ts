/**
 * In-memory API stand-in.
 *
 * Every call is async and can fail, so screens must implement the loading,
 * error, empty and offline states the specification requires. Swap the bodies
 * for real `fetch` calls - the signatures are the contract screens rely on.
 */

import * as fixtures from './fixtures';
import type {
  AiResponse,
  AnalyticsOverview,
  AppNotification,
  Brand,
  Comment,
  CommentStatus,
  HistoryEvent,
  Intent,
  MediaAsset,
  NotificationPreferences,
  Priority,
  Publication,
  PublicationStatus,
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
};

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return errorMessages[error.code];
  return 'Une erreur est survenue. Réessayez.';
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
  async login({ email, password }: Credentials): Promise<{ token: string; user: User }> {
    return request(() => {
      const normalised = email.trim().toLowerCase();
      if (normalised === 'bloque@studio-vega.fr') {
        throw new ApiError('account_disabled', errorMessages.account_disabled);
      }
      // Any password of a valid length is accepted for the demo except this one.
      if (password === 'wrongpassword' || normalised !== store.user.email) {
        throw new ApiError('invalid_credentials', errorMessages.invalid_credentials);
      }
      return { token: `demo.jwt.${Date.now()}`, user: clone(store.user) };
    }, 700);
  },

  async register(payload: RegistrationPayload): Promise<{ token: string; user: User }> {
    return request(() => {
      if (payload.email.trim().toLowerCase() === 'deja@studio-vega.fr') {
        throw new ApiError('email_taken', errorMessages.email_taken);
      }
      store.user = {
        ...store.user,
        firstName: payload.firstName,
        lastName: payload.lastName,
        displayName: payload.displayName?.trim() || `${payload.firstName} ${payload.lastName}`,
        email: payload.email.trim().toLowerCase(),
        avatarInitials: `${payload.firstName[0] ?? ''}${payload.lastName[0] ?? ''}`.toUpperCase(),
      };
      return { token: `demo.jwt.${Date.now()}`, user: clone(store.user) };
    }, 900);
  },

  /** Always resolves: the caller shows a generic message either way. */
  async requestPasswordReset(email: string): Promise<void> {
    return request(() => {
      if (email.trim().toLowerCase() === 'spam@studio-vega.fr') {
        throw new ApiError('too_many_attempts', errorMessages.too_many_attempts);
      }
    }, 700);
  },

  async resetPassword(token: string, _password: string): Promise<void> {
    return request(() => {
      if (!token || token === 'expired') {
        throw new ApiError('token_expired', 'Ce lien de réinitialisation a expiré ou a déjà été utilisé.');
      }
    }, 700);
  },

  async changePassword(current: string, next: string): Promise<void> {
    return request(() => {
      if (current === 'wrongpassword') {
        throw new ApiError('invalid_credentials', 'Le mot de passe actuel est incorrect.');
      }
      if (current === next) {
        throw new ApiError('weak_password', 'Le nouveau mot de passe doit être différent de l’ancien.');
      }
    }, 700);
  },

  /** `GET /auth/me` equivalent used by the splash screen. */
  async me(): Promise<{ user: User; brand: Brand; unreadCount: number }> {
    return request(() => ({
      user: clone(store.user),
      brand: clone(store.brands.find((b) => b.id === store.activeBrandId) ?? store.brands[0]!),
      unreadCount: store.notifications.filter((n) => !n.read).length,
    }), 600);
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
    return request(() => clone(store.user));
  },
  async update(patch: Partial<User>): Promise<User> {
    return request(() => {
      store.user = { ...store.user, ...patch };
      return clone(store.user);
    }, 700);
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
    return request(() => clone(store.brands));
  },
  async getActive(): Promise<Brand> {
    return request(() => clone(store.brands.find((b) => b.id === store.activeBrandId) ?? store.brands[0]!));
  },
  async setActive(id: string): Promise<Brand> {
    return request(() => {
      const brand = store.brands.find((b) => b.id === id);
      if (!brand) throw new ApiError('not_found', errorMessages.not_found);
      store.activeBrandId = id;
      return clone(brand);
    }, 300);
  },
  async update(id: string, patch: Partial<Brand>): Promise<Brand> {
    return request(() => {
      const index = store.brands.findIndex((b) => b.id === id);
      if (index < 0) throw new ApiError('not_found', errorMessages.not_found);
      store.brands[index] = { ...store.brands[index]!, ...patch };
      return clone(store.brands[index]!);
    }, 700);
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

function matchesFilters(publication: Publication, filters: PublicationFilters): boolean {
  if (filters.status && filters.status !== 'all' && publication.status !== filters.status) return false;

  if (filters.network && filters.network !== 'all') {
    const networks = publication.targets.map((t) => t.network);
    if (filters.network === 'multi') {
      if (networks.length < 2) return false;
    } else if (!networks.includes(filters.network)) {
      return false;
    }
  }

  if (filters.withError && !publication.targets.some((t) => t.status === 'failed')) return false;
  if (filters.withoutMedia && publication.media !== null) return false;

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = `${publication.text} ${publication.hashtags.join(' ')}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
}

export const publicationsApi = {
  /** Cursor-free pagination: callers pass the page index. */
  async list(
    filters: PublicationFilters = {},
    page = 0
  ): Promise<{ items: Publication[]; hasMore: boolean; total: number }> {
    return request(() => {
      const all = store.publications
        .filter((p) => matchesFilters(p, filters))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const items = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      return { items: clone(items), hasMore: (page + 1) * PAGE_SIZE < all.length, total: all.length };
    });
  },

  async counts(): Promise<Record<'all' | PublicationStatus, number>> {
    return request(() => {
      const base = {
        all: store.publications.length,
        draft: 0,
        scheduled: 0,
        publishing: 0,
        published: 0,
        partially_published: 0,
        failed: 0,
        cancelled: 0,
      } as Record<'all' | PublicationStatus, number>;
      for (const p of store.publications) base[p.status] += 1;
      return base;
    }, 200);
  },

  async get(id: string): Promise<Publication> {
    return request(() => {
      const found = store.publications.find((p) => p.id === id);
      if (!found) throw new ApiError('not_found', errorMessages.not_found);
      return clone(found);
    });
  },

  /** Publications scheduled or published within a given month. */
  async listForMonth(year: number, month: number): Promise<Publication[]> {
    return request(() => {
      const items = store.publications.filter((p) => {
        const iso = p.scheduledAt ?? p.publishedAt;
        if (!iso) return false;
        const date = new Date(iso);
        return date.getFullYear() === year && date.getMonth() === month;
      });
      return clone(items);
    });
  },

  async create(draft: PublicationDraft, mode: 'draft' | 'publish' | 'schedule', scheduledAt?: string) {
    return request(() => {
      if (!draft.text.trim()) throw new ApiError('conflict', 'Le texte de la publication est obligatoire.');
      if (mode !== 'draft' && draft.networks.length === 0) {
        throw new ApiError('conflict', 'Sélectionnez au moins un réseau.');
      }

      const blocked = draft.networks.find((network) => {
        const account = store.accounts.find((a) => a.network === network);
        return !account || account.status === 'expired' || account.status === 'reconnect_required';
      });
      if (blocked && mode !== 'draft') {
        throw new ApiError('token_expired', `Le compte ${blocked === 'facebook' ? 'Facebook' : 'Instagram'} doit être reconnecté.`);
      }

      const publication: Publication = {
        id: makeId('pub'),
        brandId: draft.brandId,
        brandName: store.brands.find((b) => b.id === draft.brandId)?.name ?? '',
        text: draft.text.trim(),
        language: 'fr',
        hashtags: draft.hashtags,
        media: draft.media,
        targets: draft.networks.map((network) => {
          const account = store.accounts.find((a) => a.network === network);
          return {
            network,
            accountId: account?.id ?? '',
            accountUsername: account?.username ?? '',
            status: mode === 'publish' ? ('sent' as const) : ('pending' as const),
            sentAt: mode === 'publish' ? new Date().toISOString() : null,
            attempts: mode === 'publish' ? 1 : 0,
            externalId: mode === 'publish' ? makeId('ext') : null,
            error: null,
          };
        }),
        status: mode === 'draft' ? 'draft' : mode === 'publish' ? 'published' : 'scheduled',
        authorName: store.user.firstName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        scheduledAt: mode === 'schedule' ? (scheduledAt ?? null) : null,
        publishedAt: mode === 'publish' ? new Date().toISOString() : null,
        timezone: store.user.timezone,
        metrics: {
          reactions: null,
          comments: null,
          shares: null,
          reach: null,
          impressions: null,
          engagementRate: null,
          lastSyncAt: null,
        },
        commentCount: 0,
        negativeCommentCount: 0,
        urgentCommentCount: 0,
        perNetwork: draft.perNetwork,
      };

      store.publications.unshift(publication);
      return clone(publication);
    }, 1100);
  },

  async update(id: string, patch: Partial<Publication>): Promise<Publication> {
    return request(() => {
      const index = store.publications.findIndex((p) => p.id === id);
      if (index < 0) throw new ApiError('not_found', errorMessages.not_found);
      const current = store.publications[index]!;
      if (current.status === 'publishing' || current.status === 'published') {
        throw new ApiError('conflict', 'Une publication en cours d’envoi ou publiée ne peut pas être modifiée.');
      }
      store.publications[index] = { ...current, ...patch, updatedAt: new Date().toISOString() };
      return clone(store.publications[index]!);
    }, 800);
  },

  async schedule(id: string, scheduledAt: string): Promise<Publication> {
    return request(() => {
      const publication = store.publications.find((p) => p.id === id);
      if (!publication) throw new ApiError('not_found', errorMessages.not_found);
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        throw new ApiError('conflict', 'La date et l’heure doivent être dans le futur.');
      }
      publication.scheduledAt = scheduledAt;
      publication.status = 'scheduled';
      publication.updatedAt = new Date().toISOString();
      return clone(publication);
    }, 900);
  },

  async cancelSchedule(id: string): Promise<Publication> {
    return request(() => {
      const publication = store.publications.find((p) => p.id === id);
      if (!publication) throw new ApiError('not_found', errorMessages.not_found);
      publication.status = 'cancelled';
      publication.scheduledAt = null;
      return clone(publication);
    }, 700);
  },

  async publishNow(id: string): Promise<Publication> {
    return request(() => {
      const publication = store.publications.find((p) => p.id === id);
      if (!publication) throw new ApiError('not_found', errorMessages.not_found);
      publication.status = 'published';
      publication.publishedAt = new Date().toISOString();
      publication.targets = publication.targets.map((t) => ({
        ...t,
        status: 'sent',
        sentAt: new Date().toISOString(),
        attempts: t.attempts + 1,
        externalId: t.externalId ?? makeId('ext'),
        error: null,
      }));
      return clone(publication);
    }, 1200);
  },

  /** Retries only the networks that failed. */
  async retry(id: string, network?: SocialNetwork): Promise<Publication> {
    return request(() => {
      const publication = store.publications.find((p) => p.id === id);
      if (!publication) throw new ApiError('not_found', errorMessages.not_found);
      publication.targets = publication.targets.map((target) => {
        if (target.status !== 'failed') return target;
        if (network && target.network !== network) return target;
        return {
          ...target,
          status: 'sent',
          sentAt: new Date().toISOString(),
          attempts: target.attempts + 1,
          externalId: makeId('ext'),
          error: null,
        };
      });
      publication.status = publication.targets.every((t) => t.status === 'sent') ? 'published' : publication.status;
      return clone(publication);
    }, 1200);
  },

  async remove(id: string): Promise<void> {
    return request(() => {
      store.publications = store.publications.filter((p) => p.id !== id);
    }, 700);
  },

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
