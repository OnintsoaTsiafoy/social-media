import type { AuditEntry, AuditKind, ServiceLevels } from "@/api/types";
import type { MessageKey, Translate } from "@/i18n";
import type { Tone } from "@/types";

export const SLA_STEP = 5;
export const SLA_MIN = 5;
export const SLA_MAX = 1440;

export const SLA_DEFS: ReadonlyArray<{ key: keyof ServiceLevels; label: MessageKey; description: MessageKey }> = [
  { key: "firstResponseMinutes", label: "sla.first.label", description: "sla.first.desc" },
  { key: "escalationMinutes", label: "sla.escalation.label", description: "sla.escalation.desc" },
  { key: "nightWindowMinutes", label: "sla.night.label", description: "sla.night.desc" },
];

export const AUDIT_TONE: Record<AuditKind, Tone> = {
  role: "body",
  ai: "lime",
  page: "fb",
  user: "danger",
  rule: "body",
};

export const AUDIT_KIND_LABEL: Record<AuditKind, MessageKey> = {
  role: "audit.kind.role",
  ai: "audit.kind.ai",
  page: "audit.kind.page",
  user: "audit.kind.user",
  rule: "audit.kind.rule",
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const ROLE_LABEL: Record<string, MessageKey> = {
  owner: "role.owner",
  admin: "role.admin",
  community_manager: "role.community_manager",
  viewer: "role.viewer",
};
const PLATFORM_LABEL: Record<string, MessageKey> = {
  user: "audit.platform.user",
  platform_admin: "audit.platform.platform_admin",
};
const NETWORK_LABEL: Record<string, MessageKey> = {
  facebook: "network.facebook",
  instagram: "network.instagram",
};
const RULE_LABEL: Record<string, MessageKey> = {
  negative: "rules.negative.label",
  volume: "rules.volume.label",
  vip: "rules.vip.label",
  lang: "rules.lang.label",
};
const SERVICE_LEVEL_LINE: Record<string, MessageKey> = {
  firstResponseMinutes: "audit.serviceLevels.first",
  escalationMinutes: "audit.serviceLevels.escalation",
  nightWindowMinutes: "audit.serviceLevels.night",
};

/**
 * Phrase d'une entrée du journal, dans la langue courante. Le serveur renvoie l'action et des
 * métadonnées structurées (jamais du texte) : c'est ici que l'événement devient lisible.
 */
export function describeAudit(entry: AuditEntry, t: Translate): string {
  const meta = entry.metadata;
  const user = text(meta.userName);

  switch (entry.action) {
    case "admin.membership.role_changed":
      return t("audit.membership.role_changed", {
        user,
        brand: text(meta.brandName),
        from: t(ROLE_LABEL[text(meta.from)] ?? "role.none"),
        to: t(ROLE_LABEL[text(meta.to)] ?? "role.none"),
      });
    case "admin.user.platform_role_changed":
      return t("audit.user.platform_role_changed", {
        user,
        from: t(PLATFORM_LABEL[text(meta.from)] ?? "audit.platform.user"),
        to: t(PLATFORM_LABEL[text(meta.to)] ?? "audit.platform.user"),
      });
    case "admin.user.suspended":
      return t("audit.user.suspended", { user });
    case "admin.user.reactivated":
      return t("audit.user.reactivated", { user });
    case "auth.account_deleted":
      return t("audit.account_deleted");
    case "admin.settings.keyword_added":
      return t("audit.keyword.added", { keyword: text(meta.keyword) });
    case "admin.settings.keyword_removed":
      return t("audit.keyword.removed", { keyword: text(meta.keyword) });
    case "admin.page.auto_reply_changed":
      return t(meta.enabled === true ? "audit.page.autoReplyOn" : "audit.page.autoReplyOff", { page: text(meta.pageName) });
    case "social_account.disconnected": {
      const network = NETWORK_LABEL[text(meta.provider).toLowerCase()];
      return t("audit.page.disconnected", { page: text(meta.pageName) || (network ? t(network) : "") });
    }
    case "admin.settings.supervision_updated":
      return describeSupervisionChange(meta, t);
    case "admin.settings.service_levels_updated":
      return describeServiceLevelChange(meta, t);
    default:
      return t("audit.fallback", { action: entry.action });
  }
}

function describeSupervisionChange(meta: Record<string, unknown>, t: Translate): string {
  const before = record(meta.before);
  const after = record(meta.after);
  const parts: string[] = [];

  if (typeof after.autoReply === "boolean" && after.autoReply !== before.autoReply) {
    parts.push(t(after.autoReply ? "audit.supervision.autoReplyOn" : "audit.supervision.autoReplyOff"));
  }
  if (typeof after.threshold === "number" && after.threshold !== before.threshold) {
    parts.push(t("audit.supervision.threshold", { from: Number(before.threshold), to: after.threshold }));
  }
  const beforeRules = record(before.rules);
  for (const [key, value] of Object.entries(record(after.rules))) {
    if (typeof value === "boolean" && value !== beforeRules[key]) {
      parts.push(
        t(value ? "audit.supervision.ruleOn" : "audit.supervision.ruleOff", {
          rule: t(RULE_LABEL[key] ?? "rules.negative.label"),
        }),
      );
    }
  }
  return parts.length > 0 ? parts.join(" · ") : t("audit.supervision.updated");
}

function describeServiceLevelChange(meta: Record<string, unknown>, t: Translate): string {
  const before = record(meta.before);
  const after = record(meta.after);
  const parts = Object.entries(SERVICE_LEVEL_LINE)
    .filter(([key]) => typeof after[key] === "number" && after[key] !== before[key])
    .map(([key, line]) => t(line, { from: Number(before[key]), to: Number(after[key]) }));
  return parts.length > 0 ? parts.join(" · ") : t("audit.serviceLevels.updated");
}
