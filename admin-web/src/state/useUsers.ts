import { useCallback, useMemo, useState } from "react";

import { adminApi } from "@/api/endpoints";
import type { AdminUser, EditableRole, UserFilter, UserPatch } from "@/api/types";
import { USERS_PAGE_SIZE } from "@/domain/users";
import { useI18n } from "@/i18n";
import { useAdmin } from "@/state/AdminContext";
import { useDebounced } from "@/state/useDebounced";
import { useResource } from "@/state/useResource";

/** Brouillon du tiroir : rien n'atteint le serveur avant « Enregistrer ». */
export interface Draft {
  platformAdmin: boolean;
  roles: Record<string, EditableRole>;
}

function draftOf(user: AdminUser): Draft {
  return {
    platformAdmin: user.platformRole === "platform_admin",
    roles: Object.fromEntries(
      user.memberships.filter((membership) => membership.role !== "owner").map((membership) => [membership.brandId, membership.role as EditableRole]),
    ),
  };
}

/** Ce qui a réellement changé entre le compte et le brouillon (vide = rien à envoyer). */
export function diffDraft(user: AdminUser, draft: Draft): UserPatch {
  const patch: UserPatch = {};
  if (draft.platformAdmin !== (user.platformRole === "platform_admin")) {
    patch.platformRole = draft.platformAdmin ? "platform_admin" : "user";
  }
  const memberships = user.memberships
    .filter((membership) => membership.role !== "owner" && draft.roles[membership.brandId] !== membership.role)
    .map((membership) => ({ brandId: membership.brandId, role: draft.roles[membership.brandId] as EditableRole }));
  if (memberships.length > 0) patch.memberships = memberships;
  return patch;
}

/**
 * Utilisateurs et rôles : la liste filtrable (côté serveur : statut, recherche, page) et le tiroir
 * de détail. Les modifications du tiroir sont un brouillon, appliquées en une transaction à
 * « Enregistrer ».
 */
export function useUsers() {
  const { t } = useI18n();
  const { say, sayError, memberQuery, setMemberQuery, profile, summary } = useAdmin();
  const [filter, setFilterState] = useState<UserFilter>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // La frappe met à jour l'écran tout de suite ; le serveur n'est interrogé qu'à la pause.
  const search = useDebounced(memberQuery.trim());
  const resource = useResource(
    (signal) => adminApi.users({ status: filter, q: search, page, pageSize: USERS_PAGE_SIZE }, { signal }),
    `users:${filter}:${search}:${page}`,
  );
  const { update, reload } = resource;

  const setFilter = useCallback((next: UserFilter) => {
    setFilterState(next);
    setPage(1);
  }, []);
  const setQuery = useCallback(
    (next: string) => {
      setMemberQuery(next);
      setPage(1);
    },
    [setMemberQuery],
  );

  const openUser = useMemo(
    () => resource.data?.items.find((user) => user.id === openId) ?? null,
    [resource.data, openId],
  );

  const open = useCallback((user: AdminUser) => {
    setOpenId(user.id);
    setDraft(draftOf(user));
  }, []);
  const close = useCallback(() => {
    setOpenId(null);
    setDraft(null);
  }, []);

  const setDraftRole = useCallback(
    (brandId: string, role: EditableRole) =>
      setDraft((current) => (current ? { ...current, roles: { ...current.roles, [brandId]: role } } : current)),
    [],
  );
  const toggleDraftPlatformAdmin = useCallback(
    () => setDraft((current) => (current ? { ...current, platformAdmin: !current.platformAdmin } : current)),
    [],
  );

  const apply = useCallback(
    async (user: AdminUser, patch: UserPatch, message: string) => {
      setSaving(true);
      try {
        const updated = await adminApi.updateUser(user.id, patch);
        update((current) => ({ ...current, items: current.items.map((entry) => (entry.id === updated.id ? updated : entry)) }));
        say(message);
        close();
        summary.reload();
        // Un changement de statut modifie les pastilles du filtre et la liste filtrée.
        if (patch.status) reload();
      } catch (error) {
        sayError(error);
      } finally {
        setSaving(false);
      }
    },
    [update, reload, close, say, sayError, summary],
  );

  const save = useCallback(() => {
    if (!openUser || !draft) return;
    const patch = diffDraft(openUser, draft);
    if (Object.keys(patch).length === 0) {
      say(t("drawer.toast.nothing"));
      close();
      return;
    }
    void apply(openUser, patch, t("drawer.toast.saved"));
  }, [openUser, draft, apply, say, close, t]);

  const toggleSuspension = useCallback(() => {
    if (!openUser) return;
    const suspending = openUser.status === "active";
    void apply(openUser, { status: suspending ? "suspended" : "active" }, t(suspending ? "drawer.toast.suspended" : "drawer.toast.reactivated"));
  }, [openUser, apply, t]);

  return {
    resource,
    filter,
    setFilter,
    query: memberQuery,
    setQuery,
    page,
    setPage,
    openUser,
    draft,
    saving,
    isSelf: openUser?.id === profile.id,
    open,
    close,
    setDraftRole,
    toggleDraftPlatformAdmin,
    save,
    toggleSuspension,
  };
}
