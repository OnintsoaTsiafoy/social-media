import { useCallback } from "react";

import { adminApi } from "@/api/endpoints";
import type { ConnectedPage } from "@/api/types";
import { useI18n } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { useResource } from "@/state/useResource";

const PAGES_REFRESH_MS = 60_000;

/** Pages connectées, toutes marques confondues, avec l'interrupteur de réponse automatique. */
export function usePages() {
  const { t } = useI18n();
  const { say, sayError } = useAdmin();
  const resource = useResource((signal) => adminApi.pages({ network: "all", status: "all" }, { signal }), "pages", {
    refreshMs: PAGES_REFRESH_MS,
  });
  const { update, reload } = resource;

  const setAutoReply = useCallback(
    (id: string, autoReply: boolean) =>
      update((current) => ({
        ...current,
        items: current.items.map((page) => (page.id === id ? { ...page, autoReply } : page)),
      })),
    [update],
  );

  const toggleAutoReply = useCallback(
    async (page: ConnectedPage) => {
      const next = !page.autoReply;
      setAutoReply(page.id, next); // immédiat à l'écran, annulé si le serveur refuse
      try {
        await adminApi.setPageAutoReply(page.id, next);
        say(t(next ? "pages.autoReply.toastOn" : "pages.autoReply.toastOff", { name: page.name }));
      } catch (error) {
        setAutoReply(page.id, page.autoReply);
        sayError(error);
        reload();
      }
    },
    [setAutoReply, say, sayError, reload, t],
  );

  return { resource, toggleAutoReply };
}
