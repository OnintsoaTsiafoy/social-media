import { useCallback, useState } from "react";

import { adminApi } from "@/api/endpoints";
import type { OverviewEscalation } from "@/api/types";
import { useI18n } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { useResource } from "@/state/useResource";

const OVERVIEW_REFRESH_MS = 60_000;
/** Le flux se rafraîchit vite : c'est lui qui donne l'impression de « direct ». */
const LIVE_REFRESH_MS = 10_000;

/** Données de la vue d'ensemble : agrégats de la période choisie, flux en direct, escalades. */
export function useOverview() {
  const { t } = useI18n();
  const { net, period, say, sayError, summary } = useAdmin();
  const overview = useResource(
    (signal) => adminApi.overview({ period, network: net }, { signal }),
    `overview:${period}:${net}`,
    { refreshMs: OVERVIEW_REFRESH_MS },
  );
  const live = useResource((signal) => adminApi.live({ network: net }, { signal }), `live:${net}`, {
    refreshMs: LIVE_REFRESH_MS,
  });

  /** Escalade en cours de clôture (désactive son bouton). */
  const [resolving, setResolving] = useState<string | null>(null);
  const { update, reload } = overview;

  const resolveEscalation = useCallback(
    async (escalation: OverviewEscalation) => {
      setResolving(escalation.id);
      try {
        await adminApi.resolveEscalation(escalation.id);
        update((current) => ({
          ...current,
          escalations: current.escalations.filter((entry) => entry.id !== escalation.id),
          kpis: {
            ...current.kpis,
            escalations: { ...current.kpis.escalations, open: Math.max(0, current.kpis.escalations.open - 1) },
          },
        }));
        say(t("escalations.resolved", { page: escalation.page }));
        summary.reload();
      } catch (error) {
        sayError(error);
        reload();
      } finally {
        setResolving(null);
      }
    },
    [update, reload, say, sayError, summary, t],
  );

  return { overview, live, resolving, resolveEscalation };
}
