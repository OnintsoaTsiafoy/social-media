import { StyleSheet, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardPressArea,
  intentMeta,
  networkMeta,
  priorityMeta,
  sentimentMeta,
  Text,
} from '@/components/ui';
import { formatTime } from '@/lib/format';
import { palette, spacing, themed } from '@/theme';
import type { Comment } from '@/types';

export type CommentCardProps = {
  comment: Comment;
  onPress: () => void;
  /** Renders the "Traiter" button - used on the dashboard. */
  onTreat?: () => void;
  treating?: boolean;
};

/**
 * Comment row. The leading rail encodes priority, and the badge row shows the
 * AI verdict - or an explicit "analysis pending" state when it has not run.
 */
export function CommentCard({ comment, onPress, onTreat, treating = false }: CommentCardProps) {
  const analysis = comment.analysis;
  const priority = analysis ? priorityMeta[analysis.priority] : undefined;

  if (!analysis) {
    return (
      <Card onPress={onPress} accessibilityLabel={`Commentaire de ${comment.authorName}, analyse en attente`} style={styles.pending}>
        <View style={styles.header}>
          <Avatar initials={comment.authorInitials} size={30} />
          <View style={styles.headerText}>
            <Text variant="body" weight="bold" color={palette.inkMuted} numberOfLines={1}>
              Analyse IA en attente…
            </Text>
            <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.meta}>
              {networkMeta[comment.network].label} · {formatTime(comment.publishedAt)}
            </Text>
          </View>
        </View>
        <Text variant="footnote" color={palette.inkBody} numberOfLines={2} style={styles.body}>
          « {comment.text} »
        </Text>
      </Card>
    );
  }

  return (
    <Card padded={false} accentColor={priority?.color}>
      <CardPressArea
        onPress={onPress}
        accessibilityLabel={`Commentaire de ${comment.authorName}, priorité ${priority?.label}`}
        style={styles.content}
      >
        <View style={styles.header}>
          <Avatar initials={comment.authorInitials} size={30} />
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text variant="body" weight="bold" numberOfLines={1}>
                {comment.authorName}
              </Text>
              {comment.isNew ? <View style={styles.newDot} accessibilityLabel="Nouveau" /> : null}
            </View>
            <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.meta}>
              {networkMeta[comment.network].label} · {comment.publicationTitle} · {formatTime(comment.publishedAt)}
            </Text>
          </View>
          {priority ? <Badge label={priority.label} tone={priority.tone} /> : null}
        </View>

        <Text variant="footnote" color={palette.inkBody} numberOfLines={3} style={styles.body}>
          « {comment.text} »
        </Text>
      </CardPressArea>

      <View style={styles.footer}>
        <View style={styles.badges}>
          <Badge label={sentimentMeta[analysis.sentiment].label} tone={sentimentMeta[analysis.sentiment].tone} />
          <Badge label={intentMeta[analysis.intent].label} tone="neutral" />
          {comment.response?.status === 'proposed' ? (
            <Badge label="Réponse IA prête" tone="success" icon="ai" />
          ) : null}
          {comment.status === 'escalated' ? <Badge label="Escaladé" tone="warning" icon="escalate" /> : null}
          {comment.status === 'processed' ? <Badge label="Traité" tone="neutral" icon="check" /> : null}
        </View>

        {onTreat ? (
          <Button label="Traiter" variant="primary" size="sm" onPress={onTreat} loading={treating} style={styles.treat} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    pending: { opacity: 0.8 },
    /** Card padding, minus the bottom edge the footer owns. */
    content: { padding: spacing['2xl'], paddingBottom: 0 },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
    headerText: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    newDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.lime },
    meta: { marginTop: 2 },
    body: { marginTop: spacing.xl },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xl,
      marginTop: spacing.xl,
      paddingHorizontal: spacing['2xl'],
      paddingBottom: spacing['2xl'],
    },
    badges: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    treat: { paddingHorizontal: spacing['4xl'] },
  })
);
