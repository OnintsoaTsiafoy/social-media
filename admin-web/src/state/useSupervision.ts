import { useCallback, useState } from "react";

import { adminApi } from "@/api/endpoints";
import type { QueueDraft, RejectReason, RuleKey, Supervision, SupervisionSettings } from "@/api/types";
import { useI18n } from "@/i18n";
import { omit } from "@/lib/object";
import { useAdmin } from "@/state/AdminContext";
import { useDebouncedSave } from "@/state/useDebouncedSave";
import { useResource } from "@/state/useResource";

const SUPERVISION_REFRESH_MS = 30_000;

type SettingsPatch = { autoReply?: boolean; threshold?: number; rules?: Partial<Record<RuleKey, boolean>> };

/** Retire un brouillon de la file (résolu) sans attendre le prochain rafraîchissement. */
function withoutDraft(supervision: Supervision, id: string): Supervision {
  const items = supervision.queue.items.filter((item) => item.id !== id);
  const removed = items.length !== supervision.queue.items.length;
  return {
    ...supervision,
    queue: { total: Math.max(0, supervision.queue.total - (removed ? 1 : 0)), items },
    pipeline: { ...supervision.pipeline, inReview: Math.max(0, supervision.pipeline.inReview - (removed ? 1 : 0)) },
  };
}

/**
 * Supervision IA : la file de relecture, les réglages d'autonomie et les règles d'escalade.
 * Approuver envoie réellement la réponse ; chaque décision est un retour humain pour le modèle.
 */
export function useSupervision() {
  const { t } = useI18n();
  const { say, sayError, summary } = useAdmin();
  const resource = useResource((signal) => adminApi.supervision({ signal }), "supervision", {
    refreshMs: SUPERVISION_REFRESH_MS,
  });
  const { update, reload } = resource;

  /** Brouillons dont la réponse est en cours d'envoi. */
  const [sending, setSending] = useState<Record<string, boolean>>({});
  /** Brouillon dont on demande le motif de rejet. */
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  /** Texte en cours de modification, par brouillon. */
  const [editing, setEditing] = useState<Record<string, string>>({});

  const settle = useCallback(
    (id: string) => {
      update((current) => withoutDraft(current, id));
      setFeedbackFor((current) => (current === id ? null : current));
      setEditing((map) => omit(map, id));
      summary.reload();
    },
    [update, summary],
  );

  const approve = useCallback(
    async (item: QueueDraft) => {
      setSending((map) => ({ ...map, [item.id]: true }));
      try {
        await adminApi.approveDraft(item.id, editing[item.id]);
        settle(item.id);
        say(t("supervision.toast.published", { page: item.page }));
      } catch (error) {
        sayError(error);
        // L'envoi a pu échouer après l'approbation : la proposition change d'état côté serveur.
        reload();
      } finally {
        setSending((map) => ({ ...map, [item.id]: false }));
      }
    },
    [editing, settle, say, sayError, reload, t],
  );

  const reject = useCallback(
    async (id: string, reason: RejectReason) => {
      try {
        await adminApi.rejectDraft(id, reason);
        settle(id);
        say(t("supervision.toast.rejected", { reason: t(`reason.${reason}`) }));
      } catch (error) {
        sayError(error);
        reload();
      }
    },
    [settle, say, sayError, reload, t],
  );

  const escalate = useCallback(
    async (id: string) => {
      try {
        await adminApi.escalateDraft(id);
        settle(id);
        say(t("supervision.toast.escalated"));
      } catch (error) {
        sayError(error);
        reload();
      }
    },
    [settle, say, sayError, reload, t],
  );

  const askRejectReason = useCallback((id: string) => setFeedbackFor(id), []);
  const startEdit = useCallback((item: QueueDraft) => setEditing((map) => ({ ...map, [item.id]: item.draft })), []);
  const changeEdit = useCallback((id: string, text: string) => setEditing((map) => ({ ...map, [id]: text })), []);
  const cancelEdit = useCallback((id: string) => setEditing((map) => omit(map, id)), []);

  // --- Réglages (enregistrés côté serveur, appliqués tout de suite à l'écran) ---------------------

  const applySettings = useCallback(
    (patch: SettingsPatch) =>
      update((current) => {
        const settings: SupervisionSettings = {
          ...current.settings,
          ...(patch.autoReply === undefined ? {} : { autoReply: patch.autoReply }),
          ...(patch.threshold === undefined ? {} : { threshold: patch.threshold }),
          rules: { ...current.settings.rules, ...patch.rules },
        };
        return { ...current, settings };
      }),
    [update],
  );

  const saveSettings = useCallback(
    async (patch: SettingsPatch) => {
      try {
        await adminApi.updateSupervision(patch);
      } catch (error) {
        sayError(error);
        reload(); // remet l'écran d'accord avec le serveur
      }
    },
    [sayError, reload],
  );

  // Le curseur envoie beaucoup de valeurs : une seule est enregistrée, la dernière.
  const scheduleSettings = useDebouncedSave<SettingsPatch>(saveSettings, (pending, next) => {
    const rules = { ...pending.rules, ...next.rules };
    return { ...pending, ...next, ...(Object.keys(rules).length > 0 ? { rules } : {}) };
  });

  const setThreshold = useCallback(
    (threshold: number) => {
      applySettings({ threshold });
      scheduleSettings({ threshold });
    },
    [applySettings, scheduleSettings],
  );

  const toggleRule = useCallback(
    (key: RuleKey) => {
      const enabled = !resource.data?.settings.rules[key];
      applySettings({ rules: { [key]: enabled } });
      scheduleSettings({ rules: { [key]: enabled } });
    },
    [applySettings, scheduleSettings, resource.data],
  );

  const toggleAutoReply = useCallback(() => {
    const enabled = !resource.data?.settings.autoReply;
    applySettings({ autoReply: enabled });
    void saveSettings({ autoReply: enabled });
    say(t(enabled ? "supervision.autoReply.toastOn" : "supervision.autoReply.toastOff"));
  }, [applySettings, saveSettings, resource.data, say, t]);

  return {
    resource,
    sending,
    feedbackFor,
    editing,
    approve,
    reject,
    escalate,
    askRejectReason,
    startEdit,
    changeEdit,
    cancelEdit,
    setThreshold,
    toggleRule,
    toggleAutoReply,
  };
}
