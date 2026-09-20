import { useCallback, useEffect, useState } from "react";

import { adminApi } from "@/api/endpoints";
import { ApiError } from "@/api/transport";
import type { AuditEntry, ServiceLevels } from "@/api/types";
import { SLA_MAX, SLA_MIN, SLA_STEP } from "@/domain/configuration";
import { useI18n } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { useDebouncedSave } from "@/state/useDebouncedSave";
import { useResource } from "@/state/useResource";

export const AUDIT_PAGE_SIZE = 20;

/**
 * Configuration : mots-clés de modération, niveaux de service et journal d'audit. Les mots-clés
 * sont ajoutés/retirés un par un côté serveur (deux administrateurs ne s'écrasent pas) ; les
 * délais sont enregistrés à la pause, dans l'ordre où l'administrateur les règle.
 */
export function useConfiguration() {
  const { t } = useI18n();
  const { say, sayError } = useAdmin();
  const settings = useResource((signal) => adminApi.settings({ signal }), "settings");
  const { update, reload } = settings;

  const [audit, setAudit] = useState<{ items: AuditEntry[]; total: number; page: number }>({ items: [], total: 0, page: 0 });
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const firstAuditPage = useResource((signal) => adminApi.audit({ page: 1, pageSize: AUDIT_PAGE_SIZE }, { signal }), "audit");
  const auditData = firstAuditPage.data;

  // La première page vient de la ressource ; « Afficher plus » ajoute les suivantes.
  useEffect(() => {
    if (auditData) setAudit({ items: auditData.items, total: auditData.total, page: auditData.page });
  }, [auditData]);

  const loadMoreAudit = useCallback(async () => {
    setAuditLoadingMore(true);
    try {
      const next = await adminApi.audit({ page: audit.page + 1, pageSize: AUDIT_PAGE_SIZE });
      setAudit((current) => ({ items: [...current.items, ...next.items], total: next.total, page: next.page }));
    } catch (error) {
      sayError(error);
    } finally {
      setAuditLoadingMore(false);
    }
  }, [audit.page, sayError]);

  // --- Mots-clés -------------------------------------------------------------------------------------

  const [draftKeyword, setDraftKeyword] = useState("");

  const addKeyword = useCallback(async () => {
    const word = draftKeyword.trim().toLowerCase();
    if (!word) return;
    if (settings.data?.keywords.includes(word)) {
      say(t("keywords.duplicate", { word }));
      return;
    }
    try {
      const { keywords } = await adminApi.addKeyword(word);
      update((current) => ({ ...current, keywords }));
      setDraftKeyword("");
      say(t("keywords.added", { word }));
      firstAuditPage.reload();
    } catch (error) {
      // Un autre administrateur a pu l'ajouter entre-temps.
      if (error instanceof ApiError && error.code === "conflict") {
        say(t("keywords.duplicate", { word }));
        reload();
        return;
      }
      sayError(error);
    }
  }, [draftKeyword, settings.data, update, reload, say, sayError, t, firstAuditPage]);

  const removeKeyword = useCallback(
    async (word: string) => {
      try {
        const { keywords } = await adminApi.removeKeyword(word);
        update((current) => ({ ...current, keywords }));
        say(t("keywords.removed", { word }));
        firstAuditPage.reload();
      } catch (error) {
        sayError(error);
        reload();
      }
    },
    [update, reload, say, sayError, t, firstAuditPage],
  );

  // --- Niveaux de service ------------------------------------------------------------------------------

  const saveServiceLevels = useCallback(
    async (patch: Partial<ServiceLevels>) => {
      try {
        await adminApi.updateServiceLevels(patch);
        firstAuditPage.reload();
      } catch (error) {
        sayError(error);
        reload();
      }
    },
    [sayError, reload, firstAuditPage],
  );
  const scheduleServiceLevels = useDebouncedSave<Partial<ServiceLevels>>(saveServiceLevels, (pending, next) => ({
    ...pending,
    ...next,
  }));

  const stepServiceLevel = useCallback(
    (key: keyof ServiceLevels, direction: 1 | -1) => {
      const current = settings.data?.serviceLevels[key];
      if (current === undefined) return;
      const next = Math.min(SLA_MAX, Math.max(SLA_MIN, current + direction * SLA_STEP));
      if (next === current) return;
      update((data) => ({ ...data, serviceLevels: { ...data.serviceLevels, [key]: next } }));
      scheduleServiceLevels({ [key]: next });
    },
    [settings.data, update, scheduleServiceLevels],
  );

  return {
    settings,
    audit,
    auditResource: firstAuditPage,
    auditLoadingMore,
    loadMoreAudit,
    draftKeyword,
    setDraftKeyword,
    addKeyword,
    removeKeyword,
    stepServiceLevel,
  };
}
