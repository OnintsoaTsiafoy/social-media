import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { palette, radius, spacing } from '@/theme';
import type { HistoryEvent, HistoryEventKind } from '@/types';

/** Dot colour per event kind - the design's chronological rail. */
const dotColors: Record<HistoryEventKind, string> = {
  comment_received: palette.night,
  ai_analysis: palette.info,
  response_proposed: palette.lime,
  response_edited: palette.lime,
  send_failed: palette.warning,
  response_sent: palette.successText,
  status_changed: palette.inkDisabled,
  escalated: palette.warning,
};

export function Timeline({ events }: { events: HistoryEvent[] }) {
  return (
    <View accessibilityRole="list">
      {events.map((event, index) => {
        const isLast = index === events.length - 1;

        return (
          <View key={event.id} style={styles.item}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: dotColors[event.kind] }]} />
              {!isLast ? <View style={styles.line} /> : null}
            </View>

            <View style={[styles.content, isLast && styles.contentLast]}>
              <Text variant="micro" color={palette.inkFaint}>
                {formatDateTime(event.at)}
              </Text>
              <Text variant="body" weight="bold" style={styles.title}>
                {event.title}
              </Text>

              {event.detail ? (
                <Text variant="footnote" color={palette.inkMuted} style={styles.detail}>
                  {event.detail}
                </Text>
              ) : null}

              {event.body ? (
                <View style={[styles.quote, event.kind === 'response_edited' && styles.quoteEdited]}>
                  <Text
                    variant="footnote"
                    color={event.kind === 'response_edited' ? palette.inkBody : palette.inkMuted}
                  >
                    « {event.body} »
                  </Text>
                </View>
              ) : null}

              {event.actor ? (
                <Text variant="micro" color={palette.inkDisabled} style={styles.actor}>
                  Par {event.actor}
                  {event.version ? ` · version ${event.version}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: spacing.xl },
  rail: { alignItems: 'center', width: 12 },
  dot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
  line: { flex: 1, width: 1.5, backgroundColor: palette.skeleton, marginVertical: 2 },
  content: { flex: 1, paddingBottom: spacing['4xl'] },
  contentLast: { paddingBottom: 0 },
  title: { marginTop: 2 },
  detail: { marginTop: spacing.xs },
  quote: {
    marginTop: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.white,
  },
  quoteEdited: { borderColor: palette.successBorder, backgroundColor: palette.successSurface },
  actor: { marginTop: spacing.md },
});
