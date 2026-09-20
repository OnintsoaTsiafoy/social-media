import type { EditableRole, MemberRole, UserFilter, UserStatus } from "@/api/types";
import type { Tone } from "@/types";

export const USER_FILTERS: readonly UserFilter[] = ["all", "active", "suspended"];
export const USERS_PAGE_SIZE = 25;

/** Rôles attribuables depuis la console : la propriété d'une marque ne se transfère pas ici. */
export const EDITABLE_ROLES: readonly EditableRole[] = ["admin", "community_manager", "viewer"];

export const ROLE_TONE: Record<MemberRole | "none", Tone> = {
  owner: "lime",
  admin: "info",
  community_manager: "fb",
  viewer: "body",
  none: "muted",
};

export const STATUS_TONE: Record<UserStatus, Tone> = {
  active: "success",
  suspended: "danger",
};
