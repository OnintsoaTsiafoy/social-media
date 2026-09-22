import { Pressable, StyleSheet, View } from 'react-native';

import { LegendDot, Text } from '@/components/ui';
import { buildMonthGrid, isSameDay, WEEKDAY_INITIALS } from '@/lib/format';
import { palette, radius, spacing, themed } from '@/theme';
import type { PublicationStatus } from '@/types';

export type DayMarker = { date: Date; statuses: PublicationStatus[] };

const markerColor: Partial<Record<PublicationStatus, string>> = themed(() => ({
  scheduled: palette.info,
  published: palette.successText,
  failed: palette.danger,
  partially_published: palette.danger,
}));

export type CalendarMonthProps = {
  /** Any date inside the month to display. */
  month: Date;
  selected: Date;
  onSelect: (date: Date) => void;
  markers: DayMarker[];
  /** Hides the status legend - the schedule screen does not need it. */
  showLegend?: boolean;
};

/**
 * Monday-first month grid. Each cell shows up to three dots for the statuses of
 * that day's publications, so the CM can spot failures at a glance.
 */
export function CalendarMonth({ month, selected, onSelect, markers, showLegend = true }: CalendarMonthProps) {
  const days = buildMonthGrid(month.getFullYear(), month.getMonth());
  const today = new Date();

  return (
    <View>
      <View style={styles.weekdays}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          <View key={`${initial}-${index}`} style={styles.cell}>
            <Text variant="micro" weight="semibold" color={palette.inkFaint} center>
              {initial}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth();
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, today);
          const statuses = markers.find((marker) => isSameDay(marker.date, day))?.statuses ?? [];

          return (
            <Pressable
              key={day.toISOString()}
              accessibilityRole="button"
              accessibilityLabel={`${day.getDate()}/${day.getMonth() + 1}${
                statuses.length ? `, ${statuses.length} publication(s)` : ', aucune publication'
              }`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(day)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.day,
                  isToday && !isSelected && styles.dayToday,
                  isSelected && styles.daySelected,
                ]}
              >
                <Text
                  variant="body"
                  weight={isSelected || isToday ? 'bold' : 'medium'}
                  color={
                    isSelected ? palette.onNight : inMonth ? palette.ink : palette.inkGhost
                  }
                >
                  {String(day.getDate()).padStart(2, '0')}
                </Text>

                <View style={styles.dots}>
                  {statuses.slice(0, 3).map((status, index) => (
                    <View
                      key={`${status}-${index}`}
                      style={[
                        styles.dot,
                        { backgroundColor: markerColor[status] ?? palette.inkDisabled },
                        isSelected && styles.dotOnSelected,
                      ]}
                    />
                  ))}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      {showLegend ? (
        <View style={styles.legend}>
          <LegendDot color={palette.info} label="Planifiée" />
          <LegendDot color={palette.successText} label="Publiée" />
          <LegendDot color={palette.danger} label="Échec" />
        </View>
      ) : null}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    weekdays: { flexDirection: 'row', marginBottom: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    // Seven columns: each cell takes a seventh of the row.
    cell: { width: `${100 / 7}%`, paddingVertical: 2, alignItems: 'center' },
    day: {
      width: '100%',
      minHeight: 40,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      gap: 3,
    },
    dayToday: { backgroundColor: palette.successBg },
    daySelected: { backgroundColor: palette.night },
    dots: { flexDirection: 'row', gap: 2, height: 5 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    dotOnSelected: { backgroundColor: palette.lime },
    legend: { flexDirection: 'row', gap: spacing['3xl'], marginTop: spacing['3xl'], flexWrap: 'wrap' },
  })
);
