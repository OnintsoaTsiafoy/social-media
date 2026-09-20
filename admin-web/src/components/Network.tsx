import type { ReactNode } from "react";

import type { Network } from "@/api/types";
import { InstagramGlyph } from "@/components/icons";
import { cx } from "@/lib/css";
import { NET_CODE, netTone } from "@/lib/network";

/** "FB" / "IG" pill used in lists and tables. */
export function NetBadge({ net, size = "md" }: { net: Network; size?: "sm" | "md" | "tile" }) {
  return (
    <span className={cx("net-badge", `net-badge--${size}`)} data-tone={netTone(net)}>
      {NET_CODE[net]}
    </span>
  );
}

interface NetGlyphProps {
  net: Network;
  /** Square edge in px. */
  size: number;
  radius: number;
  /** Font size of the Facebook "f". */
  fontSize: number;
  /** Instagram outline size and weight. */
  iconSize?: number;
  strokeWidth?: number;
  /** Replaces the default glyph (the live stream uses a plain "◎" for Instagram). */
  children?: ReactNode;
}

/** Brand glyph: Facebook "f" or the Instagram outline, in a tinted rounded square. */
export function NetGlyph({ net, size, radius, fontSize, iconSize, strokeWidth = 1.9, children }: NetGlyphProps) {
  return (
    <span
      className="net-glyph"
      data-tone={netTone(net)}
      style={{ width: size, height: size, borderRadius: radius, fontSize }}
    >
      {children ??
        (net === "facebook" ? "f" : <InstagramGlyph size={iconSize ?? Math.round(size * 0.55)} strokeWidth={strokeWidth} />)}
    </span>
  );
}
