import type { Tone } from "@/types";

export type Role = "Senior CM" | "Community Mgr" | "Moderator" | "Analyst";
export type UserStatus = "Active" | "Invited" | "Suspended";
export type UserFilter = "All" | UserStatus;

export type PermissionKey = "reply" | "moderate" | "analytics" | "approveAi" | "export";
export type PermissionSet = Record<PermissionKey, boolean>;

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  pages: string;
  seen: string;
  replies: string;
  avgResponse: string;
  permissions: PermissionSet;
}

export const ROLES: Role[] = ["Senior CM", "Community Mgr", "Moderator", "Analyst"];
export const USER_FILTERS: UserFilter[] = ["All", "Active", "Invited", "Suspended"];

export const ROLE_TONE: Record<Role, Tone> = {
  "Senior CM": "lime",
  Moderator: "info",
  Analyst: "body",
  "Community Mgr": "fb",
};

export const STATUS_TONE: Record<UserStatus, Tone> = {
  Active: "success",
  Invited: "warning",
  Suspended: "danger",
};

export const PERMISSIONS: Array<{ key: PermissionKey; label: string; description: string }> = [
  { key: "reply", label: "Reply to comments", description: "Publish replies from the mobile app on assigned pages." },
  { key: "moderate", label: "Hide & delete comments", description: "Moderate content without an admin approval step." },
  { key: "analytics", label: "Access sentiment analytics", description: "See page-level sentiment and response dashboards." },
  { key: "approveAi", label: "Approve AI drafts", description: "Send AI-generated replies below the autonomy threshold." },
  { key: "export", label: "Export data", description: "Download comment archives and performance reports." },
];

export const DEFAULT_PERMISSIONS: PermissionSet = {
  reply: true,
  moderate: true,
  analytics: true,
  approveAi: false,
  export: false,
};

type Seed = Omit<UserRecord, "permissions">;

const SEEDS: Seed[] = [
  { id: 1, name: "Nadia Belhadj", email: "nadia.b@pulse.io", role: "Senior CM", status: "Active", pages: "4 pages", seen: "2 min ago", replies: "412", avgResponse: "3m 08s" },
  { id: 2, name: "Yacine Ferhat", email: "yacine.f@pulse.io", role: "Community Mgr", status: "Active", pages: "3 pages", seen: "11 min ago", replies: "388", avgResponse: "4m 44s" },
  { id: 3, name: "Lina Moreau", email: "lina.m@pulse.io", role: "Moderator", status: "Active", pages: "1 page", seen: "1 h ago", replies: "204", avgResponse: "6m 02s" },
  { id: 4, name: "Karim Saïdi", email: "karim.s@pulse.io", role: "Community Mgr", status: "Invited", pages: "—", seen: "pending", replies: "0", avgResponse: "—" },
  { id: 5, name: "Sofia Ricci", email: "sofia.r@pulse.io", role: "Analyst", status: "Active", pages: "read-only", seen: "yesterday", replies: "—", avgResponse: "—" },
  { id: 6, name: "Thomas Weber", email: "thomas.w@pulse.io", role: "Community Mgr", status: "Suspended", pages: "2 pages", seen: "2 d ago", replies: "96", avgResponse: "9m 21s" },
  { id: 7, name: "Amel Haddad", email: "amel.h@pulse.io", role: "Senior CM", status: "Active", pages: "5 pages", seen: "8 min ago", replies: "467", avgResponse: "2m 51s" },
  { id: 8, name: "Dylan Okafor", email: "dylan.o@pulse.io", role: "Moderator", status: "Invited", pages: "2 pages", seen: "pending", replies: "0", avgResponse: "—" },
];

export const INITIAL_USERS: UserRecord[] = SEEDS.map((seed) => ({
  ...seed,
  permissions: { ...DEFAULT_PERMISSIONS },
}));

/** Accounts in the workspace; the table above shows a sample of them. */
export const TOTAL_ACCOUNTS = 58;
