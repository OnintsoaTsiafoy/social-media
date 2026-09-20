import type { ConnectedPage, PageHealth } from "@/api/types";
import type { Formatters, Translate } from "@/i18n";
import type { Tone } from "@/types";

export const PAGE_STATUS_TONE: Record<PageHealth, Tone> = {
  healthy: "success",
  attention: "warning",
  action_required: "danger",
};

export const BACKLOG_WARNING = 30;
export const BACKLOG_CRITICAL = 80;

const DAY_MS = 86_400_000;

/** État de l'import des publications : combien la page en compte, et quand il a abouti pour la dernière fois. */
export function describePostsSync(page: Pick<ConnectedPage, "lastPostsSyncAt" | "postsCount">, t: Translate, format: Formatters, now = new Date()): string {
  if (!page.lastPostsSyncAt) return t("pages.posts.never", { count: page.postsCount });
  return t("pages.posts.synced", { count: page.postsCount, when: format.relative(new Date(page.lastPostsSyncAt), now) });
}

/** Phrase d'état du jeton, d'après les métadonnées renvoyées par l'API (jamais le jeton lui-même). */
export function describeToken(token: ConnectedPage["token"], t: Translate, format: Formatters, now = new Date()): string {
  switch (token.state) {
    case "valid":
      return t("pages.token.valid", { date: format.longDate(new Date(token.expiresAt ?? now)) });
    case "expiring": {
      const days = Math.max(1, Math.ceil((new Date(token.expiresAt ?? now).getTime() - now.getTime()) / DAY_MS));
      return t("pages.token.expiring", { count: days });
    }
    case "expired":
      return t("pages.token.expired");
    case "error":
      return token.message ? t("pages.token.errorDetail", { detail: token.message }) : t("pages.token.error");
    case "unknown":
      return t("pages.token.unknown");
  }
}
