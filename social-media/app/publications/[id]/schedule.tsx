import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CalendarMonth } from '@/components/domain/CalendarMonth';
import { networksLabel } from '@/components/domain/PublicationCard';
import {
  AppHeader,
  Button,
  Callout,
  Card,
  DetailRow,
  Divider,
  ErrorState,
  IconButton,
  Screen,
  SelectField,
  SkeletonList,
  Text,
  Thumbnail,
  useFeedback,
} from '@/components/ui';
import { publicationsApi } from '@/data/api';
import { REMINDER_OPTIONS, TIME_SLOT_OPTIONS } from '@/data/options';
import { useAsync, useMutation } from '@/hooks/useAsync';
import {
  combineDateAndTime,
  excerpt,
  formatDateTimeIn,
  formatMonthYear,
  formatTimezone,
} from '@/lib/format';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 12 - Planification (`/publications/:id/schedule`)
 *
 * The chosen instant must be in the future; execution itself is the server's
 * job, which the screen states so the user knows the phone can be switched off.
 */
export default function SchedulePublicationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast } = useFeedback();
  const mutation = useMutation();

  const request = useAsync(() => publicationsApi.get(id), [id]);
  const publication = request.data;

  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });
  const [time, setTime] = useState('12:30');
  const [reminder, setReminder] = useState('30');
  const [error, setError] = useState<string | undefined>(undefined);

  // Le créneau saisi est lu dans le fuseau annoncé à l'écran, jamais celui du téléphone.
  const timezone = publication?.timezone ?? 'Europe/Paris';
  const scheduledIso = combineDateAndTime(selected, time, timezone);
  const inPast = new Date(scheduledIso).getTime() <= Date.now();

  const blockedAccount = publication?.targets.length === 0;

  const confirmSchedule = async () => {
    if (inPast) {
      setError('Choisissez une date et une heure futures.');
      return;
    }
    setError(undefined);

    const result = await mutation.run(() => publicationsApi.schedule(id, scheduledIso, timezone));
    if (!result.ok) return;

    toast(`Publication planifiée le ${formatDateTimeIn(scheduledIso, timezone)}.`, 'success');
    router.replace(`/publications/${id}`);
  };

  const shiftMonth = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <Screen
      scroll
      header={<AppHeader title="Planifier" showBack />}
      footer={
        publication ? (
          <Button
            label="Confirmer la planification"
            onPress={confirmSchedule}
            loading={mutation.pending}
            disabled={inPast || blockedAccount}
            block
          />
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : publication ? (
        <>
          <Card style={styles.calendarCard}>
            <View style={styles.monthRow}>
              <Text variant="callout" weight="bold">
                {formatMonthYear(month)}
              </Text>
              <View style={styles.monthNav}>
                <IconButton
                  name="back"
                  accessibilityLabel="Mois précédent"
                  size={32}
                  onPress={() => shiftMonth(-1)}
                />
                <IconButton
                  name="forward"
                  accessibilityLabel="Mois suivant"
                  size={32}
                  onPress={() => shiftMonth(1)}
                />
              </View>
            </View>

            <CalendarMonth
              month={month}
              selected={selected}
              onSelect={(date) => {
                setSelected(date);
                setError(undefined);
              }}
              markers={[]}
              showLegend={false}
            />
          </Card>

          <View style={styles.row}>
            <SelectField
              label="Heure"
              value={time}
              options={TIME_SLOT_OPTIONS}
              onChange={(value) => {
                setTime(value);
                setError(undefined);
              }}
              sheetTitle="Heure d’envoi"
              containerStyle={styles.rowItem}
            />
            <View style={styles.rowItem}>
              <Text variant="eyebrow" style={styles.timezoneLabel}>
                Fuseau
              </Text>
              <Card style={styles.timezoneCard}>
                <Text variant="body" weight="bold" numberOfLines={1}>
                  {formatTimezone(publication.timezone)}
                </Text>
                <Text variant="micro" color={palette.inkFaint}>
                  Fuseau de votre profil
                </Text>
              </Card>
            </View>
          </View>

          <SelectField
            label="Rappel avant envoi"
            value={reminder}
            options={REMINDER_OPTIONS}
            onChange={setReminder}
          />

          {error ? <Callout tone="danger">{error}</Callout> : null}
          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

          {blockedAccount ? (
            <Callout tone="warning" icon="priority">
              Cette publication ne cible aucun réseau. Ajoutez un réseau avant de la planifier.
            </Callout>
          ) : null}

          <Card style={styles.summaryCard}>
            <Text variant="eyebrow">Résumé</Text>
            <View style={styles.summaryHead}>
              <Thumbnail size={48} uri={publication.media?.uri} />
              <Text variant="footnote" color={palette.inkBody} style={styles.summaryText}>
                {excerpt(publication.text, 80)}
              </Text>
            </View>
            <Divider />
            <DetailRow label="Marque" value={publication.brandName} />
            <DetailRow label="Réseaux" value={networksLabel(publication)} />
            <DetailRow
              label="Comptes"
              value={publication.targets.map((target) => target.accountUsername).join(', ') || '-'}
            />
            <DetailRow label="Envoi" value={formatDateTimeIn(scheduledIso, timezone)} />
            <DetailRow label="Fuseau" value={formatTimezone(publication.timezone)} />
          </Card>

          <Callout tone="success" icon="shield">
            L’envoi est exécuté par le serveur, même application fermée ou téléphone éteint.
          </Callout>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  calendarCard: { gap: spacing.xl },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthNav: { flexDirection: 'row', gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.xl },
  rowItem: { flex: 1 },
  timezoneLabel: { marginBottom: spacing.md },
  timezoneCard: { gap: 2, minHeight: 52, justifyContent: 'center' },
  summaryCard: { gap: spacing.xl },
  summaryHead: { flexDirection: 'row', gap: spacing.xl, alignItems: 'center' },
  summaryText: { flex: 1 },
});
