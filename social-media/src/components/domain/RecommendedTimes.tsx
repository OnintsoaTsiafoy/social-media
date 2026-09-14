import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  type BadgeTone,
  Button,
  Callout,
  Card,
  Chip,
  ChipWrap,
  Divider,
  Skeleton,
  Text,
} from '@/components/ui';
import { analyticsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { formatDelta, nextOccurrenceOfWeekday } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { BestTimeConfidence, BestTimeSlot, SocialNetwork } from '@/types';

const NETWORK_LABEL: Record<SocialNetwork, string> = { facebook: 'Facebook', instagram: 'Instagram' };

const CONFIDENCE_META: Record<BestTimeConfidence, { label: string; tone: BadgeTone }> = {
  high: { label: 'Confiance élevée', tone: 'success' },
  medium: { label: 'Confiance moyenne', tone: 'warning' },
  low: { label: 'Confiance faible', tone: 'neutral' },
};

const pad = (value: number) => String(value).padStart(2, '0');

/** `HH:00` — le début de la tranche recommandée, seule information horaire
 * qu'un créneau porte (les tranches n'ont pas de minute précise). */
function slotTime(slot: BestTimeSlot): string {
  return `${pad(slot.slotStartHour)}:00`;
}

function slotShortLabel(slot: BestTimeSlot): string {
  return `${slot.weekdayLabel} ${slotTime(slot)}`;
}

export type RecommendedTimesCardProps = {
  brandId: string;
  network: SocialNetwork;
  timezone: string;
  /** Remplit le calendrier/l'heure de l'écran de planification avec ce créneau. */
  onUseSlot: (date: Date, time: string) => void;
};

/**
 * ÉCRAN 12 — section "Horaires recommandés" (TODO_RECOMMANDATION_MEILLEUR_HORAIRE).
 *
 * Un réseau à la fois : le classement backend sépare toujours Facebook et
 * Instagram, jamais mélangés dans une même recommandation. Jamais bloquant :
 * une erreur ou une absence de données n'empêche pas de planifier "à la main".
 */
export function RecommendedTimesCard({ brandId, network, timezone, onUseSlot }: RecommendedTimesCardProps) {
  const request = useAsync(
    () => analyticsApi.bestTimes(brandId, network, '30d', timezone),
    [brandId, network, timezone]
  );
  const explainMutation = useMutation();
  const [explanation, setExplanation] = useState<string | undefined>(undefined);
  const networkLabel = NETWORK_LABEL[network];

  const applySlot = (slot: BestTimeSlot) => {
    const time = slotTime(slot);
    onUseSlot(nextOccurrenceOfWeekday(slot.weekday, time, timezone), time);
  };

  const explain = async () => {
    const result = await explainMutation.run(() => analyticsApi.explainBestTimes(brandId, network, '30d', timezone));
    if (result.ok) setExplanation(result.data.text);
  };

  if (request.loading) {
    return (
      <Card style={styles.card}>
        <Text variant="eyebrow">Horaires recommandés · {networkLabel}</Text>
        <Skeleton height={56} />
      </Card>
    );
  }

  if (request.error || !request.data) return null;

  const result = request.data;

  if (result.status === 'insufficient_data') {
    return (
      <Card style={styles.card}>
        <Text variant="eyebrow">Horaires recommandés · {networkLabel}</Text>
        <Text variant="footnote" color={palette.inkFaint}>
          Pas encore assez de publications {networkLabel} avec des statistiques exploitables sur cette période
          pour recommander un horaire ({result.analyzedCount} sur {result.minimumRequired} minimum par créneau).
        </Text>
      </Card>
    );
  }

  const best = result.best as BestTimeSlot;

  return (
    <Card style={styles.card}>
      <Text variant="eyebrow">Horaires recommandés · {networkLabel}</Text>

      <View style={styles.bestRow}>
        <View style={styles.bestInfo}>
          <Text variant="callout" weight="bold">
            {slotShortLabel(best)}
          </Text>
          <View style={styles.bestMeta}>
            <Badge label={CONFIDENCE_META[best.confidence].label} tone={CONFIDENCE_META[best.confidence].tone} />
            {best.deltaVsAveragePercent !== null ? (
              <Text variant="micro" color={palette.inkFaint}>
                {formatDelta(best.deltaVsAveragePercent)} d’engagement moyen
              </Text>
            ) : null}
          </View>
          <Text variant="micro" color={palette.inkFaint}>
            {best.sampleSize} publications analysées
          </Text>
        </View>
        <Button label="Utiliser cet horaire" variant="secondary" size="sm" onPress={() => applySlot(best)} />
      </View>

      {result.alternatives.length > 0 ? (
        <>
          <Divider />
          <Text variant="micro" color={palette.inkFaint}>
            Alternatives
          </Text>
          <ChipWrap>
            {result.alternatives.map((slot) => (
              <Chip
                key={`${slot.weekday}-${slot.slotStartHour}`}
                label={slotShortLabel(slot)}
                variant="tag"
                onPress={() => applySlot(slot)}
              />
            ))}
          </ChipWrap>
        </>
      ) : null}

      {explanation ? (
        <Callout tone="info">{explanation}</Callout>
      ) : (
        <View>
          <Button label="Pourquoi ce choix ?" variant="ghost" size="sm" loading={explainMutation.pending} onPress={explain} />
          {explainMutation.error ? <Callout tone="danger">{explainMutation.error}</Callout> : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  bestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  bestInfo: { flex: 1, gap: spacing.xs },
  bestMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
