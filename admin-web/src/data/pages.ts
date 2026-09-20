import type { NetworkCode, Tone } from "@/types";

export type PageStatus = "Healthy" | "Attention" | "Rate limited";

export interface ConnectedPage {
  id: string;
  net: NetworkCode;
  name: string;
  handle: string;
  followers: string;
  status: PageStatus;
  comments24h: number;
  backlog: number;
  token: string;
  team: string[];
  teamLabel: string;
  /** Initial state of the per-page auto-reply switch. */
  autoReply: boolean;
}

export const CONNECTED_PAGES: ConnectedPage[] = [
  { id: "p1", net: "FB", name: "Nova Cosmetics", handle: "@novacosmetics", followers: "412k", status: "Healthy", comments24h: 1284, backlog: 12, token: "Token valid until 14 Mar 2027", team: ["NB", "AH", "LM"], teamLabel: "3 managers", autoReply: true },
  { id: "p2", net: "IG", name: "Nova Cosmetics", handle: "@nova.official", followers: "268k", status: "Healthy", comments24h: 942, backlog: 34, token: "Token valid until 14 Mar 2027", team: ["AH", "YF"], teamLabel: "2 managers", autoReply: true },
  { id: "p3", net: "FB", name: "Aurora Travel", handle: "@auroratravel", followers: "156k", status: "Rate limited", comments24h: 611, backlog: 88, token: "Graph API throttled · retry in 12 min", team: ["YF", "DO"], teamLabel: "2 managers", autoReply: false },
  { id: "p4", net: "IG", name: "Aurora Travel", handle: "@aurora.trips", followers: "97k", status: "Healthy", comments24h: 402, backlog: 9, token: "Token valid until 02 Jan 2027", team: ["YF"], teamLabel: "1 manager", autoReply: true },
  { id: "p5", net: "FB", name: "Helio Energy", handle: "@helioenergy", followers: "88k", status: "Attention", comments24h: 356, backlog: 141, token: "Token expires in 6 days — renew", team: ["LM", "TW"], teamLabel: "2 managers", autoReply: true },
  { id: "p6", net: "FB", name: "Maison Verte", handle: "@maisonverte", followers: "34k", status: "Healthy", comments24h: 118, backlog: 3, token: "Token valid until 21 Jun 2027", team: ["NB"], teamLabel: "1 manager", autoReply: false },
];

export const PAGE_STATUS_TONE: Record<PageStatus, Tone> = {
  Healthy: "success",
  Attention: "warning",
  "Rate limited": "danger",
};

export const BACKLOG_WARNING = 30;
export const BACKLOG_CRITICAL = 80;
