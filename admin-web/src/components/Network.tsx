import type { ReactNode } from "react";

import { InstagramGlyph } from "@/components/icons";
import { cx } from "@/lib/css";
import { netTone } from "@/lib/network";
import type { NetworkCode } from "@/types";

/** "FB" / "IG" pill used in lists and tables. */
export function NetBadge({ net, size = "md" }: { net: NetworkCode; size?: "sm" | "md" | "tile" }) {
  return (
    <span className={cx("net-badge", `net-badge--${size}`)} data-tone={netTone(net)}>
      {net}
    </span>
  );
}

interface NetGlyphProps {
  net: NetworkCode;
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
        (net === "FB" ? "f" : <InstagramGlyph size={iconSize ?? Math.round(size * 0.55)} strokeWidth={strokeWidth} />)}
    </span>
  );
}
