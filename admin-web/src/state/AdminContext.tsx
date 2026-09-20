import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { adminApi } from "@/api/endpoints";
import { toUserMessage } from "@/api/errors";
import type { AdminProfile, Metric, Period, SentimentFilter } from "@/api/types";
import { useI18n } from "@/i18n";
import type { NetFilter } from "@/types";
import { useRoute } from "@/state/useRoute";
import { useResource } from "@/state/useResource";
import { useToast } from "@/state/useToast";

/** Rafraîchissement silencieux des compteurs de la coque (barre latérale, barre du haut). */
const SUMMARY_REFRESH_MS = 30_000;

/**
 * Filtres de l'analytique. Ils vivent au-dessus de l'écran pour survivre à une navigation
 * (aller voir les utilisateurs puis revenir) ; les données, elles, sont chargées par l'écran.
 */
function useAnalyticsFilters() {
  const [metric, setMetric] = useState<Metric>("engagement");
  const [period, setPeriod] = useState<Period>("30d");
  const [sentiment, setSentiment] = useState<SentimentFilter>("all");
  const [pageId, setPageId] = useState<string | undefined>(undefined);
  return { metric, setMetric, period, setPeriod, sentiment, setSentiment, pageId, setPageId };
}

/**
 * État partagé entre les écrans : route, toast, filtres. Les données de chaque écran sont
 * chargées par son propre hook (`state/use*.ts`), seulement quand l'écran est ouvert. Seuls
 * les compteurs de la coque sont chargés en permanence.
 */
function useAdminState(profile: AdminProfile) {
  const route = useRoute();
  const { t } = useI18n();
  const { toast, say } = useToast();
  const [net, setNet] = useState<NetFilter>("all");
  const [period, setPeriod] = useState<Period>("7d");
  const [memberQuery, setMemberQuery] = useState("");
  const analytics = useAnalyticsFilters();
  const summary = useResource((signal) => adminApi.summary({ signal }), "summary", { refreshMs: SUMMARY_REFRESH_MS });

  const sayError = useCallback((error: unknown) => say(toUserMessage(error, t)), [say, t]);

  return { ...route, profile, toast, say, sayError, net, setNet, period, setPeriod, memberQuery, setMemberQuery, analytics, summary };
}

export type AdminState = ReturnType<typeof useAdminState>;

const AdminContext = createContext<AdminState | null>(null);

export function AdminProvider({ profile, children }: { profile: AdminProfile; children: ReactNode }) {
  const state = useAdminState(profile);
  return <AdminContext.Provider value={state}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminState {
  const state = useContext(AdminContext);
  if (!state) throw new Error("useAdmin must be used inside <AdminProvider>");
  return state;
}
