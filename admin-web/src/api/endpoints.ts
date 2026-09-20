import { api } from "./client";
import type {
  AdminSession,
  AdminSettings,
  AdminSummary,
  AdminUser,
  AuditPage,
  DraftOutcome,
  LiveActivity,
  Metric,
  NetworkFilter,
  Overview,
  PageHealth,
  PageList,
  PagePerformance,
  Period,
  RejectReason,
  SentimentFilter,
  ServiceLevels,
  Supervision,
  SupervisionSettings,
  Trend,
  UserFilter,
  UserList,
  UserPatch,
} from "./types";

type Signal = { signal?: AbortSignal };

/**
 * Toutes les routes de l'API d'administration, une fonction par route. C'est la seule porte
 * réseau de la console : les écrans ne construisent jamais d'URL eux-mêmes.
 */
export const adminApi = {
  session: (options: Signal = {}) => api<AdminSession>("/admin/session", options),
  summary: (options: Signal = {}) => api<AdminSummary>("/admin/summary", options),

  overview: (params: { period: Period; network: NetworkFilter }, options: Signal = {}) =>
    api<Overview>("/admin/overview", { query: params, ...options }),
  live: (params: { network: NetworkFilter }, options: Signal = {}) =>
    api<LiveActivity>("/admin/live", { query: params, ...options }),

  supervision: (options: Signal = {}) => api<Supervision>("/admin/supervision", options),
  approveDraft: (id: string, text?: string) =>
    api<DraftOutcome>(`/admin/supervision/drafts/${id}/approve`, { method: "POST", body: text ? { text } : {} }),
  rejectDraft: (id: string, reason: RejectReason) =>
    api<DraftOutcome>(`/admin/supervision/drafts/${id}/reject`, { method: "POST", body: { reason } }),
  escalateDraft: (id: string) =>
    api<DraftOutcome>(`/admin/supervision/drafts/${id}/escalate`, { method: "POST", body: {} }),
  resolveEscalation: (commentId: string) =>
    api<{ id: string; status: "processed" }>(`/admin/escalations/${commentId}/resolve`, { method: "POST", body: {} }),

  trend: (
    params: { metric: Metric; period: Period; sentiment: SentimentFilter; pageId?: string; network: NetworkFilter },
    options: Signal = {},
  ) => api<Trend>("/admin/analytics/trend", { query: params, ...options }),
  pagePerformance: (params: { period: Period; network: NetworkFilter; pageId?: string }, options: Signal = {}) =>
    api<PagePerformance>("/admin/analytics/pages", { query: params, ...options }),

  users: (params: { status: UserFilter; q: string; page: number; pageSize: number }, options: Signal = {}) =>
    api<UserList>("/admin/users", { query: params, ...options }),
  updateUser: (id: string, patch: UserPatch) => api<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: patch }),

  pages: (params: { network: NetworkFilter; status: "all" | PageHealth }, options: Signal = {}) =>
    api<PageList>("/admin/pages", { query: params, ...options }),
  setPageAutoReply: (id: string, autoReply: boolean) =>
    api<{ id: string; autoReply: boolean }>(`/admin/pages/${id}`, { method: "PATCH", body: { autoReply } }),

  settings: (options: Signal = {}) => api<AdminSettings>("/admin/settings", options),
  addKeyword: (word: string) =>
    api<{ keywords: string[] }>("/admin/settings/keywords", { method: "POST", body: { word } }),
  removeKeyword: (word: string) =>
    api<{ keywords: string[] }>(`/admin/settings/keywords/${encodeURIComponent(word)}`, { method: "DELETE" }),
  updateServiceLevels: (patch: Partial<ServiceLevels>) =>
    api<{ serviceLevels: ServiceLevels }>("/admin/settings/service-levels", { method: "PATCH", body: patch }),
  updateSupervision: (patch: {
    autoReply?: boolean;
    threshold?: number;
    rules?: Partial<SupervisionSettings["rules"]>;
  }) => api<{ supervision: SupervisionSettings }>("/admin/settings/supervision", { method: "PATCH", body: patch }),
  audit: (params: { page: number; pageSize: number }, options: Signal = {}) =>
    api<AuditPage>("/admin/audit", { query: params, ...options }),
};
