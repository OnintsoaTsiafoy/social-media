import { describe, expect, it } from "vitest";

import type { AuditEntry } from "@/api/types";
import { translate, type Formatters, type Translate } from "@/i18n";
import { formatInt, formatLongDate, formatPoints } from "@/i18n/format";
import { OVERVIEW } from "@/test/fixtures";

import { describeAudit } from "./configuration";
import { buildHealth, overallHealth } from "./overview";
import { describeToken } from "./pages";
import { describeThreshold, shareAtOrAbove } from "./supervision";

const t: Translate = (key, params) => translate("fr", key, params);
const format = {
  int: (value: number) => formatInt("fr", value),
  points: (value: number) => formatPoints("fr", value),
  longDate: (date: Date) => formatLongDate("fr", date),
} as Formatters;

const entry = (action: string, metadata: Record<string, unknown> = {}): AuditEntry => ({
  id: "x",
  at: "2026-09-20T12:00:00.000Z",
  action,
  kind: null,
  actor: null,
  metadata,
});

describe("seuil d'autonomie", () => {
  // 10 brouillons à 60 %, 30 à 85 %.
  const distribution = Array.from({ length: 100 }, (_, index) => (index === 60 ? 10 : index === 85 ? 30 : 0));

  it("calcule la part des brouillons qui atteignent le seuil, sur les données réelles", () => {
    expect(shareAtOrAbove(distribution, 82)).toBe(0.75);
    expect(shareAtOrAbove(distribution, 86)).toBe(0);
    expect(shareAtOrAbove(distribution, 50)).toBe(1);
  });

  it("n'invente rien sans brouillon", () => {
    expect(shareAtOrAbove(Array(100).fill(0), 82)).toBeNull();
    expect(describeThreshold(82, Array(100).fill(0), t, format).text).toContain("Pas encore assez de brouillons");
  });

  it("décrit un seuil équilibré par la part qui passerait sans relecture", () => {
    const note = describeThreshold(82, distribution, t, format);
    expect(note.tone).toBe("success");
    expect(note.text).toBe("Équilibré : environ 75 % des brouillons passeraient sans relecture.");
  });

  it("décrit un seuil strict par la part qui exigerait une relecture", () => {
    const note = describeThreshold(90, distribution, t, format);
    expect(note.tone).toBe("info");
    expect(note.text).toContain("100 %");
  });

  it("avertit qu'un seuil permissif laisse passer des brouillons sensibles", () => {
    expect(describeThreshold(60, distribution, t, format).tone).toBe("warning");
  });
});

describe("santé du système", () => {
  it("colore chaque mesure selon ses seuils et ne fabrique pas de zéro", () => {
    const rows = buildHealth(OVERVIEW.health, format, t);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    // 10 échecs sur 200 = 5 % : le seuil rouge est atteint.
    expect(byId.webhookFailures).toMatchObject({ value: "10 / 200", tone: "danger" });
    expect(byId.webhookLatency).toMatchObject({ value: "212 ms", tone: "success" });
    expect(byId.backlog).toMatchObject({ value: "120", tone: "warning" });
    expect(byId.tokens).toMatchObject({ value: "2 pages", tone: "danger" });
  });

  it("affiche « Aucun webhook » plutôt qu'un taux sur zéro événement", () => {
    const rows = buildHealth(
      { webhooks: { total24h: 0, failed24h: 0, averageLatencyMs: null }, moderationBacklog: 0, tokens: { expiringWithinSevenDays: 0, connectedPages: 0 } },
      format,
      t,
    );
    expect(rows[0]).toMatchObject({ value: "Aucun webhook reçu", tone: "muted", percent: 0 });
    expect(rows[1]).toMatchObject({ value: "Non disponible", tone: "muted" });
    expect(overallHealth(rows)).toBe("operational");
  });

  it("résume l'état global par la pire mesure", () => {
    expect(overallHealth(buildHealth(OVERVIEW.health, format, t))).toBe("degraded");
  });
});

describe("jeton d'une page", () => {
  const now = new Date("2026-09-20T00:00:00.000Z");

  it("décrit l'état à partir des métadonnées", () => {
    expect(describeToken({ state: "valid", expiresAt: "2027-03-14T00:00:00.000Z", message: null }, t, format, now)).toBe(
      "Jeton valable jusqu'au dimanche 14 mars 2027",
    );
    expect(describeToken({ state: "expiring", expiresAt: "2026-09-26T00:00:00.000Z", message: null }, t, format, now)).toBe(
      "Le jeton expire dans 6 jours : à renouveler",
    );
    expect(describeToken({ state: "expiring", expiresAt: "2026-09-20T05:00:00.000Z", message: null }, t, format, now)).toContain("dans 1 jour");
    expect(describeToken({ state: "expired", expiresAt: null, message: null }, t, format, now)).toContain("expiré");
    expect(describeToken({ state: "unknown", expiresAt: null, message: null }, t, format, now)).toContain("non communiquée");
  });

  it("reprend le détail de l'erreur quand l'API en donne un", () => {
    expect(describeToken({ state: "error", expiresAt: null, message: "Invalid OAuth token" }, t, format, now)).toBe(
      "Reconnexion requise : Invalid OAuth token",
    );
    expect(describeToken({ state: "error", expiresAt: null, message: null }, t, format, now)).toBe("Reconnexion requise");
  });
});

describe("journal d'audit", () => {
  it("rend chaque action lisible dans la langue courante", () => {
    expect(
      describeAudit(entry("admin.membership.role_changed", { userName: "Amel Haddad", brandName: "Studio Vega", from: "community_manager", to: "admin" }), t),
    ).toBe("Amel Haddad : rôle Community manager → Administrateur sur Studio Vega");
    expect(describeAudit(entry("admin.user.suspended", { userName: "Thomas Weber" }), t)).toBe("Thomas Weber suspendu");
    expect(describeAudit(entry("admin.settings.keyword_added", { keyword: "boycott" }), t)).toBe(
      "Mot-clé « boycott » ajouté au filtre de modération",
    );
    expect(describeAudit(entry("admin.page.auto_reply_changed", { pageName: "Nova", enabled: true }), t)).toBe(
      "Réponse automatique activée sur Nova",
    );
    expect(describeAudit(entry("admin.user.platform_role_changed", { userName: "Sofia", from: "user", to: "platform_admin" }), t)).toContain(
      "aucun → administrateur",
    );
  });

  it("décrit uniquement ce qui a changé dans les réglages de supervision", () => {
    const text = describeAudit(
      entry("admin.settings.supervision_updated", {
        before: { autoReply: false, threshold: 78, rules: { vip: true, lang: false } },
        after: { autoReply: true, threshold: 82, rules: { vip: true, lang: true } },
      }),
      t,
    );
    expect(text).toBe(
      "Réponse automatique activée · Seuil d'autonomie 78 % → 82 % · Règle « Langue non prise en charge » activée",
    );
  });

  it("décrit les délais de service modifiés", () => {
    expect(
      describeAudit(
        entry("admin.settings.service_levels_updated", {
          before: { firstResponseMinutes: 15, escalationMinutes: 45, nightWindowMinutes: 30 },
          after: { firstResponseMinutes: 20, escalationMinutes: 45, nightWindowMinutes: 30 },
        }),
        t,
      ),
    ).toBe("Délai de première réponse 15 → 20 min");
  });

  it("nomme le réseau d'une page déconnectée quand son nom est inconnu", () => {
    expect(describeAudit(entry("social_account.disconnected", { provider: "INSTAGRAM" }), t)).toBe("Page Instagram déconnectée");
  });

  it("retombe sur l'action brute pour un événement inconnu, sans planter", () => {
    expect(describeAudit(entry("brand.frobnicated"), t)).toBe("Action « brand.frobnicated »");
    expect(describeAudit(entry("admin.settings.supervision_updated", {}), t)).toBe("Réglages de supervision IA modifiés");
  });

  it("parle anglais quand la langue le demande", () => {
    expect(describeAudit(entry("admin.user.reactivated", { userName: "Thomas" }), (key, params) => translate("en", key, params))).toBe(
      "Thomas reactivated",
    );
  });
});
