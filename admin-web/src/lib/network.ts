import type { Network } from "@/api/types";
import type { MessageKey } from "@/i18n";
import type { NetFilter, Tone } from "@/types";

/** « FB » / « IG » : le sigle affiché dans les pastilles. */
export const NET_CODE: Record<Network, "FB" | "IG"> = { facebook: "FB", instagram: "IG" };

export function netTone(network: Network): Tone {
  return network === "facebook" ? "fb" : "ig";
}

export const NET_LABEL: Record<NetFilter, MessageKey> = {
  all: "network.allCaps",
  facebook: "network.facebookCaps",
  instagram: "network.instagramCaps",
};

/** Libellé en casse normale d'un réseau (« Facebook »). */
export const NET_NAME: Record<Network, MessageKey> = {
  facebook: "network.facebook",
  instagram: "network.instagram",
};
