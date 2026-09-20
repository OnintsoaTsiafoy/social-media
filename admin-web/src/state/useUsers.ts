import { useCallback, useMemo, useState } from "react";

import {
  INITIAL_USERS,
  USER_FILTERS,
  type PermissionKey,
  type PermissionSet,
  type Role,
  type UserFilter,
  type UserRecord,
} from "@/data/users";

interface Draft {
  role: Role;
  permissions: PermissionSet;
}

/**
 * Users & roles: the filterable member list plus the detail drawer. Edits in the
 * drawer are a draft — they only reach the list on "Save changes".
 */
export function useUsers(say: (message: string) => void) {
  const [users, setUsers] = useState<UserRecord[]>(INITIAL_USERS);
  const [filter, setFilter] = useState<UserFilter>("All");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users
      .filter((user) => filter === "All" || user.status === filter)
      .filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(needle));
  }, [users, filter, query]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        USER_FILTERS.map((name) => [
          name,
          name === "All" ? users.length : users.filter((user) => user.status === name).length,
        ]),
      ) as Record<UserFilter, number>,
    [users],
  );

  const openUser = users.find((user) => user.id === openId) ?? null;

  const open = useCallback(
    (id: number) => {
      const user = users.find((candidate) => candidate.id === id);
      if (!user) return;
      setOpenId(id);
      setDraft({ role: user.role, permissions: { ...user.permissions } });
    },
    [users],
  );

  const close = useCallback(() => {
    setOpenId(null);
    setDraft(null);
  }, []);

  const setDraftRole = useCallback(
    (role: Role) => setDraft((current) => (current ? { ...current, role } : current)),
    [],
  );

  const toggleDraftPermission = useCallback(
    (key: PermissionKey) =>
      setDraft((current) =>
        current
          ? { ...current, permissions: { ...current.permissions, [key]: !current.permissions[key] } }
          : current,
      ),
    [],
  );

  const save = useCallback(() => {
    if (openId !== null && draft) {
      setUsers((list) =>
        list.map((user) =>
          user.id === openId ? { ...user, role: draft.role, permissions: draft.permissions } : user,
        ),
      );
    }
    close();
    say("Permissions updated · synced to mobile app");
  }, [openId, draft, close, say]);

  const suspend = useCallback(() => {
    if (openId !== null) {
      setUsers((list) =>
        list.map((user) => (user.id === openId ? { ...user, status: "Suspended" } : user)),
      );
    }
    close();
    say("Account suspended");
  }, [openId, close, say]);

  return {
    visible,
    counts,
    filter,
    setFilter,
    query,
    setQuery,
    openUser,
    draft,
    open,
    close,
    setDraftRole,
    toggleDraftPermission,
    save,
    suspend,
  };
}
