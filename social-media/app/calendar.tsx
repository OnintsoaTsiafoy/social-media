import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CalendarMonth, type DayMarker } from '@/components/domain/CalendarMonth';
import { PublicationRow } from '@/components/domain/PublicationCard';
import {
  AppHeader,
  Button,
  Card,
  ErrorState,
  IconButton,
  Screen,
  SectionHeader,
  SegmentedControl,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { publicationsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { formatLongDay, formatMonthYear, formatTime, isSameDay } from '@/lib/format';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 13 - Calendrier éditorial (`/calendar`)
 *
 * Month grid plus the selected day's list. The month query is cached per month
 * by `useAsync`'s dependency array, so paging back and forth is cheap.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const { toast } = useFeedback();

  const [view, setView] = useState<'month' | 'day'>('month');
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());

  const request = useAsync(
    () => publicationsApi.listForMonth(month.getFullYear(), month.getMonth()),
    [month.getFullYear(), month.getMonth()]
  );

  // Memoised so the derived `markers` and day list keep stable identities.
  const publications = useMemo(() => request.data ?? [], [request.data]);

  const markers = useMemo<DayMarker[]>(() => {
    const byDay = new Map<string, DayMarker>();
    for (const publication of publications) {
      const iso = publication.scheduledAt ?? publication.publishedAt;
      if (!iso) continue;
      const date = new Date(iso);
      const key = date.toDateString();
      const existing = byDay.get(key);
      if (existing) existing.statuses.push(publication.status);
      else byDay.set(key, { date, statuses: [publication.status] });
    }
    return [...byDay.values()];
  }, [publications]);

  const dayPublications = useMemo(
    () =>
      publications
        .filter((publication) => {
          const iso = publication.scheduledAt ?? publication.publishedAt;
          return iso ? isSameDay(new Date(iso), selected) : false;
        })
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [publications, selected]
  );

  const shiftMonth = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const goToToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(today);
  };

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <AppHeader
          title="Calendrier"
          showBack
          actions={
            <SegmentedControl
              label="Vue du calendrier"
              value={view}
              options={[
                { value: 'month', label: 'Mois' },
                { value: 'day', label: 'Jour' },
              ]}
              onChange={setView}
            />
          }
        />
      }
    >
      <View style={styles.monthRow}>
        <Text variant="callout" weight="bold">
          {formatMonthYear(month)}
        </Text>
        <View style={styles.monthNav}>
          <IconButton name="back" accessibilityLabel="Mois précédent" size={34} onPress={() => shiftMonth(-1)} />
          <Button label="Aujourd’hui" variant="secondary" size="sm" onPress={goToToday} />
          <IconButton name="forward" accessibilityLabel="Mois suivant" size={34} onPress={() => shiftMonth(1)} />
        </View>
      </View>

      {request.error ? (
        <ErrorState compact message={request.error} onRetry={request.reload} />
      ) : null}

      {view === 'month' ? (
        <Card style={styles.calendarCard}>
          {request.loading ? (
            <SkeletonList count={2} withThumbnail={false} />
          ) : (
            <CalendarMonth
              month={month}
              selected={selected}
              onSelect={setSelected}
              markers={markers}
            />
          )}
        </Card>
      ) : null}

      <View style={styles.daySection}>
        <SectionHeader
          title={formatLongDay(selected)}
          actionLabel={`${dayPublications.length} publication${dayPublications.length > 1 ? 's' : ''}`}
          onActionPress={() => undefined}
        />

        {request.loading ? (
          <SkeletonList count={2} />
        ) : dayPublications.length === 0 ? (
          <Card tone="dashed" onPress={() => router.push('/publications/new')}>
            <Text variant="body" weight="bold" center color={palette.inkMuted}>
              Aucune publication ce jour
            </Text>
            <Text variant="micro" color={palette.inkFaint} center style={styles.emptyHint}>
              Créez une publication pour cette date.
            </Text>
          </Card>
        ) : (
          <View style={styles.dayList}>
            {dayPublications.map((publication) => (
              <PublicationRow
                key={publication.id}
                publication={publication}
                onPress={() => router.push(`/publications/${publication.id}`)}
                timeLabel={
                  publication.scheduledAt
                    ? formatTime(publication.scheduledAt)
                    : publication.publishedAt
                      ? formatTime(publication.publishedAt)
                      : undefined
                }
              />
            ))}
          </View>
        )}

        <Card
          tone="dashed"
          onPress={() => {
            toast('La date sélectionnée sera pré-remplie à l’étape de planification.', 'info');
            router.push('/publications/new');
          }}
        >
          <Text variant="body" weight="bold" center color={palette.inkMuted}>
            + Créer pour le {selected.getDate()}/{String(selected.getMonth() + 1).padStart(2, '0')}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xl },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  calendarCard: { gap: spacing.xl },
  daySection: { gap: spacing.xl },
  dayList: { gap: spacing.lg },
  emptyHint: { marginTop: spacing.sm },
});
