import type { NetFilter, NetworkCode, Tone } from "@/types";

export function matchesNet(filter: NetFilter, net: NetworkCode): boolean {
  return filter === "all" || filter === net.toLowerCase();
}

export function netTone(net: NetworkCode): Tone {
  return net === "FB" ? "fb" : "ig";
}

export const NET_LABEL: Record<NetFilter, string> = {
  all: "ALL NETWORKS",
  fb: "FACEBOOK",
  ig: "INSTAGRAM",
};
