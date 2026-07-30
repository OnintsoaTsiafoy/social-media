import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Timeline } from '@/components/domain/Timeline';
import {
  AppHeader,
  BottomSheet,
  Button,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { commentsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 20 - Historique des échanges (`/comments/:id/history`)
 *
 * Read-only and chronological: versions are kept for audit, so nothing on this
 * screen can be edited or deleted.
 */
export default function CommentHistoryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { toast } = useFeedback();

  const history = useAsync(() => commentsApi.history(id), [id]);
  const comment = useAsync(() => commentsApi.get(id), [id]);
  const [comparing, setComparing] = useState(false);

  const events = history.data ?? [];
  const proposed = events.find((event) => event.kind === 'response_proposed');
  const edited = [...events].reverse().find((event) => event.kind === 'response_edited');
  const canCompare = Boolean(proposed?.body && edited?.body);

  return (
    <Screen
      scroll
      refreshing={history.refreshing}
      onRefresh={history.refresh}
      header={
        <AppHeader
          title="Historique"
          showBack
          actionLabel={canCompare ? 'Comparer' : undefined}
          onActionPress={() => setComparing(true)}
        />
      }
      footer={
        <Button
          label="Retour au commentaire"
          variant="secondary"
          onPress={() => router.replace(`/comments/${id}`)}
          block
        />
      }
    >
      {history.loading ? (
        <SkeletonList count={4} withThumbnail={false} />
      ) : history.error ? (
        <ErrorState message={history.error} onRetry={history.reload} />
      ) : events.length === 0 ? (
        <EmptyState
          icon="clock"
          title="Aucun événement"
          message="Ce commentaire n’a pas encore d’historique. Les analyses, propositions et envois apparaîtront ici."
        />
      ) : (
        <>
          {comment.data ? (
            <Card tone="muted" style={styles.summary}>
              <Text variant="eyebrow">Commentaire</Text>
              <Text variant="footnote" color={palette.inkMuted}>
                {comment.data.authorName} · « {comment.data.text} »
              </Text>
            </Card>
          ) : null}

          <Timeline events={events} />

          <Callout tone="neutral" icon="lock">
            Historique non modifiable · conservé pour l’audit et le mémoire.
          </Callout>
        </>
      )}

      <BottomSheet
        visible={comparing}
        onClose={() => setComparing(false)}
        title="Proposition vs version finale"
        footer={<Button label="Fermer" variant="secondary" onPress={() => setComparing(false)} block />}
      >
        <View style={styles.compare}>
          <Card style={styles.compareCard}>
            <Text variant="eyebrow">Proposition IA (v1)</Text>
            <Text variant="footnote" color={palette.inkMuted}>
              « {proposed?.body} »
            </Text>
            <Text
              variant="micro"
              weight="bold"
              color={palette.inkMuted}
              accessibilityRole="button"
              onPress={() => toast('Proposition copiée.', 'info')}
            >
              Copier
            </Text>
          </Card>

          <Card tone="success" style={styles.compareCard}>
            <Text variant="eyebrow">Version validée{edited?.version ? ` (v${edited.version})` : ''}</Text>
            <Text variant="footnote" color={palette.inkBody}>
              « {edited?.body} »
            </Text>
            {edited?.actor ? (
              <Text variant="micro" color={palette.inkFaint}>
                Modifiée par {edited.actor}
              </Text>
            ) : null}
          </Card>
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.md },
  compare: { gap: spacing.xl },
  compareCard: { gap: spacing.md },
});
