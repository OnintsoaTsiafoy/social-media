import { adminApi } from "@/api/endpoints";
import { METRICS_WITHOUT_SENTIMENT } from "@/domain/analytics";
import { useAdmin } from "@/state/AdminContext";
import { useResource } from "@/state/useResource";

/** Courbe et tableau de l'analytique, pour les filtres partagés (voir AdminContext). */
export function useAnalytics() {
  const { analytics, net } = useAdmin();
  const { metric, period, sentiment, pageId } = analytics;
  // Ne pas relancer la requête pour un filtre sans effet sur l'indicateur.
  const effectiveSentiment = METRICS_WITHOUT_SENTIMENT.includes(metric) ? "all" : sentiment;

  const trend = useResource(
    (signal) => adminApi.trend({ metric, period, sentiment: effectiveSentiment, pageId, network: net }, { signal }),
    `trend:${metric}:${period}:${effectiveSentiment}:${pageId ?? ""}:${net}`,
  );
  const pages = useResource(
    (signal) => adminApi.pagePerformance({ period, network: net, pageId }, { signal }),
    `pages:${period}:${pageId ?? ""}:${net}`,
  );
  return { trend, pages };
}
