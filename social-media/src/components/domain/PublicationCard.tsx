import { StyleSheet, View } from 'react-native';

import { Badge, Button, Card, CardPressArea, publicationStatusMeta, Text, Thumbnail } from '@/components/ui';
import { excerpt, formatDateTime, formatDateTimeIn, formatTime, formatTimezone } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { Publication } from '@/types';

/** Short "FB + IG" style summary of the targeted networks. */
export function networksLabel(publication: Publication): string {
  const networks = publication.targets.map((target) => target.network);
  if (networks.length === 0) return 'Aucun réseau';
  if (networks.length > 1) return 'FB + IG';
  return networks[0] === 'facebook' ? 'Facebook' : 'Instagram';
}

/** The date that matters for the current status. */
function timingLabel(publication: Publication): string {
  if (publication.status === 'scheduled' && publication.scheduledAt) {
    return `${formatDateTimeIn(publication.scheduledAt, publication.timezone)} ${formatTimezone(publication.timezone).split(' · ')[0]}`;
  }
  if (publication.publishedAt) return formatDateTime(publication.publishedAt);
  return `Créé le ${formatDateTime(publication.createdAt)}`;
}

export type PublicationCardProps = {
  publication: Publication;
  onPress: () => void;
  /** Shown for failed / partially published items. */
  onRetry?: () => void;
  retrying?: boolean;
};

export function PublicationCard({ publication, onPress, onRetry, retrying = false }: PublicationCardProps) {
  const status = publicationStatusMeta[publication.status];
  const hasError = publication.targets.some((target) => target.status === 'failed');
  const isDraft = publication.status === 'draft';

  const metrics = [
    publication.metrics.reactions !== null ? `${publication.metrics.reactions} réactions` : null,
    publication.commentCount > 0 ? `${publication.commentCount} commentaires` : null,
  ].filter(Boolean);

  return (
    <Card
      tone={hasError ? 'danger' : isDraft && !publication.media ? 'dashed' : 'default'}
      padded={false}
    >
      <CardPressArea
        onPress={onPress}
        accessibilityLabel={`${excerpt(publication.text, 60)} - ${status.label}`}
        style={styles.content}
      >
        <View style={styles.head}>
          {publication.media || !isDraft ? (
            <Thumbnail size={54} uri={publication.media?.uri} />
          ) : null}
          <View style={styles.headText}>
            <Text variant="body" weight="bold" numberOfLines={2}>
              {excerpt(publication.text, 72)}
            </Text>
            <Text variant="micro" color={palette.inkFaint} style={styles.meta} numberOfLines={1}>
              {publication.brandName} · {networksLabel(publication)}
            </Text>
          </View>
        </View>
      </CardPressArea>

      <View style={styles.footer}>
        <Badge label={status.label} tone={status.tone} />

        {onRetry && hasError && publication.approvalValid && ['failed', 'partially_published'].includes(publication.status) ? (
          <Button label="Relancer" variant="primary" size="sm" onPress={onRetry} loading={retrying} style={styles.retry} />
        ) : (
          <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.timing}>
            {[timingLabel(publication), ...metrics].join(' · ')}
          </Text>
        )}
      </View>
    </Card>
  );
}

/** Compact variant for the dashboard and calendar day lists. */
export function PublicationRow({
  publication,
  onPress,
  timeLabel,
}: {
  publication: Publication;
  onPress: () => void;
  timeLabel?: string;
}) {
  const status = publicationStatusMeta[publication.status];

  return (
    <Card
      onPress={onPress}
      accentColor={status.color}
      accessibilityLabel={`${excerpt(publication.text, 50)} - ${status.label}`}
      style={styles.row}
    >
      <Thumbnail size={44} uri={publication.media?.uri} radiusValue={12} />
      <View style={styles.rowText}>
        <Text variant="body" weight="bold" numberOfLines={1}>
          {excerpt(publication.text, 48)}
        </Text>
        <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.meta}>
          {[
            timeLabel ?? (publication.scheduledAt ? formatTime(publication.scheduledAt) : undefined),
            networksLabel(publication),
            status.label,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  /** Card padding, minus the bottom edge the footer owns. */
  content: { padding: spacing['2xl'], paddingBottom: 0 },
  head: { flexDirection: 'row', gap: spacing.xl },
  headText: { flex: 1 },
  meta: { marginTop: spacing.xs },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xl,
    marginTop: spacing['2xl'],
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['2xl'],
  },
  timing: { flex: 1, textAlign: 'right' },
  retry: { paddingHorizontal: spacing['4xl'] },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  rowText: { flex: 1 },
});
