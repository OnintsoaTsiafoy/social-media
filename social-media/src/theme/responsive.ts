import { useMemo } from 'react';
import { useWindowDimensions, type ViewStyle } from 'react-native';

/**
 * Breakpoints in dp. Phones sit under `md`; foldables and tablets above it.
 */
export const breakpoint = {
  /** iPhone SE / small Androids. */
  sm: 360,
  /** Large phones. */
  md: 414,
  /** Tablets & unfolded foldables. */
  lg: 768,
} as const;

export type Responsive = {
  width: number;
  height: number;
  /** Narrow phones - tighten gutters and allow smaller cards. */
  isCompact: boolean;
  /** Tablets / desktop web - centre the content column. */
  isExpanded: boolean;
  isLandscape: boolean;
  /** Horizontal screen padding. */
  gutter: number;
  /** Max width of the readable content column. */
  contentMaxWidth: number;
};

/**
 * Single source of truth for layout decisions that depend on screen size.
 * Everything else uses flex or `autoGridCell`, so this only decides gutters
 * and the width of the readable content column.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const isCompact = width < breakpoint.sm;
    const isExpanded = width >= breakpoint.lg;

    return {
      width,
      height,
      isCompact,
      isExpanded,
      isLandscape: width > height,
      gutter: isCompact ? 16 : isExpanded ? 24 : 20,
      contentMaxWidth: isExpanded ? 640 : width,
    };
  }, [width, height]);
}

/**
 * Style for a cell in a wrapping grid: the cell never gets narrower than
 * `minWidth`, and shares any leftover space equally with its row.
 *
 * Combined with `flexDirection: 'row'`, `flexWrap: 'wrap'` and a `gap` on the
 * container, this yields as many columns as the screen can fit - two metric
 * cards on a phone, four on a tablet - with no breakpoint bookkeeping.
 */
export function autoGridCell(minWidth: number): ViewStyle {
  return { flexGrow: 1, flexBasis: minWidth, minWidth };
}
