import { StyleSheet, View } from 'react-native';

import { palette, radius, spacing } from '@/theme';

import { Text } from './Text';

export type StackedBar = { label: string; facebook: number; instagram: number };

/**
 * Stacked bar chart, drawn with plain Views - no chart dependency, and it
 * scales with the container. Values are normalised against the tallest bar.
 */
export function StackedBarChart({
  data,
  height = 96,
  legend = true,
}: {
  data: StackedBar[];
  height?: number;
  legend?: boolean;
}) {
  const max = Math.max(1, ...data.map((bucket) => bucket.facebook + bucket.instagram));

  return (
    <View>
      <View style={[styles.bars, { height }]}>
        {data.map((bucket) => {
          const total = bucket.facebook + bucket.instagram;
          return (
            <View
              key={bucket.label}
              accessibilityLabel={`${bucket.label} : ${bucket.facebook} Facebook, ${bucket.instagram} Instagram`}
              style={styles.barColumn}
            >
              <View style={styles.barStack}>
                <View
                  style={[
                    styles.barSegment,
                    styles.barTop,
                    { height: (bucket.facebook / max) * (height - 18), backgroundColor: palette.lime },
                  ]}
                />
                <View
                  style={[
                    styles.barSegment,
                    styles.barBottom,
                    { height: (bucket.instagram / max) * (height - 18), backgroundColor: palette.info },
                  ]}
                />
              </View>
              <Text variant="micro" color={palette.inkFaint} numberOfLines={1}>
                {bucket.label}
              </Text>
              <Text
                variant="micro"
                weight="semibold"
                color={palette.inkDisabled}
                numberOfLines={1}
                style={styles.barTotal}
              >
                {total}
              </Text>
            </View>
          );
        })}
      </View>

      {legend ? (
        <View style={styles.legend}>
          <LegendDot color={palette.lime} label="Facebook" />
          <LegendDot color={palette.info} label="Instagram" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Sentiment distribution. Rendered as a segmented horizontal meter rather than
 * a pie: it needs no SVG dependency and stays legible at any width.
 */
export function SentimentMeter({
  positive,
  neutral,
  negative,
}: {
  positive: number;
  neutral: number;
  negative: number;
}) {
  const total = Math.max(1, positive + neutral + negative);
  const segments = [
    { value: positive, color: palette.lime, label: 'Positifs' },
    { value: neutral, color: palette.trackAlt, label: 'Neutres' },
    { value: negative, color: palette.danger, label: 'Négatifs' },
  ];

  return (
    <View style={styles.meterBlock}>
      <View style={styles.totalRow}>
        <Text variant="display" weight="extrabold">
          {positive + neutral + negative}
        </Text>
        <Text variant="micro" color={palette.inkFaint}>
          commentaires analysés
        </Text>
      </View>

      <View
        accessibilityLabel={`${positive} positifs, ${neutral} neutres, ${negative} négatifs`}
        style={styles.meter}
      >
        {segments.map((segment) =>
          segment.value > 0 ? (
            <View
              key={segment.label}
              style={{ flex: segment.value / total, backgroundColor: segment.color }}
            />
          ) : null
        )}
      </View>

      <View style={styles.meterLegend}>
        {segments.map((segment) => (
          <LegendDot
            key={segment.label}
            color={segment.color}
            label={`${segment.label} (${segment.value})`}
          />
        ))}
      </View>
    </View>
  );
}

/** Per-network comparison bars, as on the publication analytics screen. */
export function ComparisonBar({
  label,
  value,
  valueLabel,
  max,
  color,
}: {
  label: string;
  value: number | null;
  valueLabel: string;
  max: number;
  color: string;
}) {
  const ratio = value === null ? 0 : Math.min(1, value / Math.max(1, max));

  return (
    <View style={styles.comparison}>
      <View style={styles.comparisonHeader}>
        <Text variant="body" weight="semibold">
          {label}
        </Text>
        <Text variant="micro" color={palette.inkFaint}>
          {valueLabel}
        </Text>
      </View>
      <View style={styles.comparisonTrack}>
        <View style={[styles.comparisonFill, { width: `${ratio * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text variant="micro" weight="medium" color={palette.inkMuted}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.lg },
  barColumn: { flex: 1, alignItems: 'center', gap: 2 },
  barStack: { flex: 1, justifyContent: 'flex-end', alignSelf: 'stretch', gap: 2 },
  barSegment: { minHeight: 3 },
  barTop: { borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs },
  barBottom: { borderBottomLeftRadius: radius.xs, borderBottomRightRadius: radius.xs },
  barTotal: { marginTop: -2 },

  legend: { flexDirection: 'row', gap: spacing['3xl'], marginTop: spacing['3xl'] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  legendDot: { width: 9, height: 9, borderRadius: 3 },

  meterBlock: { gap: spacing['3xl'] },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  meter: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: palette.track,
  },
  meterLegend: { gap: spacing.md },

  comparison: { gap: spacing.md },
  comparisonHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  comparisonTrack: { height: 8, borderRadius: radius.pill, backgroundColor: palette.track, overflow: 'hidden' },
  comparisonFill: { height: '100%', borderRadius: radius.pill },
});
