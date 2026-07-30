import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  DetailRow,
  Divider,
  ErrorState,
  Icon,
  IconButton,
  ListRow,
  Screen,
  SkeletonList,
  Text,
  intentMeta,
  networkMeta,
  priorityMeta,
  sentimentMeta,
  useFeedback,
} from '@/components/ui';
import { commentsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { CommentStatus } from '@/types';

/**
 * ÉCRAN 18 - Détail d’un commentaire (`/comments/:id`)
 *
 * Shows the received comment, the AI verdict and the proposed reply. Nothing is
 * ever sent from here: sending requires the explicit human validation step on
 * the response editor.
 */
export default function CommentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirm, toast } = useFeedback();
  const mutation = useMutation();

  const request = useAsync(() => commentsApi.get(id), [id]);
  const comment = request.data;

  const analysis = comment?.analysis;
  const response = comment?.response;

  const setStatus = async (status: CommentStatus, label: string) => {
    if (!comment) return;

    if (status === 'ignored' || status === 'escalated') {
      const confirmed = await confirm({
        title: status === 'ignored' ? 'Ignorer ce commentaire ?' : 'Escalader ce commentaire ?',
        message:
          status === 'ignored'
            ? 'Il n’apparaîtra plus dans les commentaires à traiter.'
            : 'Il sera signalé comme nécessitant une intervention humaine prioritaire.',
        confirmLabel: label,
        destructive: status === 'ignored',
      });
      if (!confirmed) return;
    }

    const result = await mutation.run(() => commentsApi.setStatus(comment.id, status));
    if (!result.ok) return;
    request.setData(result.data);
    toast(`Commentaire ${label.toLowerCase()}.`, 'success');
  };

  const analyse = async () => {
    if (!comment) return;
    const result = await mutation.run(() => commentsApi.analyse(comment.id));
    if (!result.ok) return;
    request.setData(result.data);
    toast('Analyse IA terminée.', 'success');
  };

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <AppHeader
          title="Commentaire"
          showBack
          actions={
            comment ? (
              <IconButton
                name="clock"
                accessibilityLabel="Historique des échanges"
                onPress={() => router.push(`/comments/${comment.id}/history`)}
              />
            ) : undefined
          }
        />
      }
      footer={
        comment && !comment.deletedOnPlatform ? (
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Button
                label="Ignorer"
                variant="secondary"
                size="sm"
                onPress={() => setStatus('ignored', 'Ignoré')}
                disabled={mutation.pending}
                style={styles.footerButton}
              />
              <Button
                label="Escalader"
                variant="secondary"
                size="sm"
                onPress={() => setStatus('escalated', 'Escaladé')}
                disabled={mutation.pending}
                style={styles.footerButton}
              />
              <Button
                label={analysis ? 'Réanalyser' : 'Analyser'}
                variant="secondary"
                size="sm"
                icon="ai"
                onPress={analyse}
                loading={mutation.pending}
                style={styles.footerButton}
              />
            </View>
            <Button
              label={response ? 'Modifier & valider la réponse' : 'Générer une réponse'}
              onPress={() => router.push(`/comments/${comment.id}/response`)}
              block
            />
          </View>
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : comment ? (
        <>
          {comment.deletedOnPlatform ? (
            <Callout tone="warning" icon="priority" title="Commentaire supprimé">
              Ce commentaire a été supprimé sur la plateforme. Il n’est plus possible d’y répondre.
            </Callout>
          ) : null}

          {/* Section 1 - the comment as received */}
          <Card style={styles.card}>
            <View style={styles.author}>
              <Avatar initials={comment.authorInitials} size={38} />
              <View style={styles.authorText}>
                <Text variant="bodyLg" weight="bold">
                  {comment.authorName}
                </Text>
                <Text variant="micro" color={palette.inkFaint}>
                  {networkMeta[comment.network].label} · {formatDateTime(comment.publishedAt)}
                </Text>
              </View>
              {comment.isNew ? <Badge label="Nouveau" tone="accent" /> : null}
            </View>

            <Text variant="bodyLg" color={palette.inkBody}>
              « {comment.text} »
            </Text>

            <Divider />

            <ListRow
              label="Publication liée"
              description={comment.publicationTitle}
              onPress={() => router.push(`/publications/${comment.publicationId}`)}
              style={styles.linkedRow}
            />
          </Card>

          {/* Section 2 - AI analysis */}
          {analysis ? (
            <Card style={styles.card}>
              <View style={styles.analysisHeader}>
                <View style={styles.analysisTitle}>
                  <Icon name="ai" size={16} color={palette.night} />
                  <Text variant="bodyLg" weight="extrabold">
                    Analyse IA
                  </Text>
                </View>
                <Text variant="micro" color={palette.inkFaint}>
                  confiance {Math.round(analysis.confidence * 100)} %
                </Text>
              </View>

              <View style={styles.badges}>
                <Badge
                  label={sentimentMeta[analysis.sentiment].label}
                  tone={sentimentMeta[analysis.sentiment].tone}
                />
                <Badge label={intentMeta[analysis.intent].label} tone="neutral" />
                <Badge
                  label={`Priorité ${priorityMeta[analysis.priority].label.toLowerCase()}`}
                  tone={priorityMeta[analysis.priority].tone}
                />
                {analysis.urgent ? <Badge label="Urgent" tone="warning" icon="urgent" /> : null}
                {analysis.sensitive ? <Badge label="Sensible" tone="warning" /> : null}
              </View>

              <Text variant="footnote" color={palette.inkBody}>
                {analysis.explanation}
              </Text>

              <Divider />

              <DetailRow label="Action recommandée" value={analysis.recommendedAction} />
              <DetailRow label="Analysé" value={formatRelative(analysis.analysedAt)} />
              <DetailRow label="Modèle" value={analysis.modelVersion} />
            </Card>
          ) : (
            <Card tone="muted" style={styles.card}>
              <Text variant="bodyLg" weight="bold">
                Analyse IA en attente
              </Text>
              <Text variant="footnote" color={palette.inkMuted}>
                Ce commentaire n’a pas encore été analysé. Lancez l’analyse pour obtenir le sentiment,
                l’intention et la priorité.
              </Text>
              <Button
                label="Analyser maintenant"
                variant="secondary"
                size="sm"
                icon="ai"
                onPress={analyse}
                loading={mutation.pending}
              />
            </Card>
          )}

          {/* Section 4 - proposed reply */}
          {response ? (
            <Card tone="success" style={styles.card}>
              <View style={styles.analysisHeader}>
                <Text variant="bodyLg" weight="extrabold">
                  Réponse proposée
                </Text>
                {response.generatedByAi ? <Badge label="Généré par l’IA" tone="accent" /> : null}
              </View>

              <Text variant="bodyLg" color={palette.inkBody}>
                {response.text}
              </Text>

              <View style={styles.responseMeta}>
                <Text variant="micro" color={palette.inkFaint}>
                  {response.language.toUpperCase()}
                </Text>
                <Text variant="micro" color={palette.inkFaint}>
                  Ton {response.tone}
                </Text>
                <Text variant="micro" color={palette.inkFaint}>
                  {response.status === 'sent' ? 'Envoyée' : 'À valider'}
                </Text>
                <Text variant="micro" color={palette.inkFaint}>
                  v{response.version}
                </Text>
              </View>
            </Card>
          ) : null}

          {/* Section 3 - history entry point */}
          <Card padded={false}>
            <ListRow
              label="Historique des échanges"
              description={`Statut actuel : ${statusLabel(comment.status)} · reçu le ${formatDate(comment.publishedAt)}`}
              onPress={() => router.push(`/comments/${comment.id}/history`)}
            />
          </Card>

          <Callout tone="warning" icon="info">
            Aucune réponse n’est envoyée automatiquement. Une validation humaine est obligatoire avant
            publication.
          </Callout>

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
        </>
      ) : null}
    </Screen>
  );
}

function statusLabel(status: CommentStatus): string {
  const labels: Record<CommentStatus, string> = {
    new: 'nouveau',
    untreated: 'non traité',
    treated: 'traité',
    ignored: 'ignoré',
    escalated: 'escaladé',
  };
  return labels[status];
}

const styles = StyleSheet.create({
  card: { gap: spacing.xl },
  author: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  authorText: { flex: 1 },
  linkedRow: { paddingHorizontal: 0, paddingVertical: 0 },
  analysisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xl,
  },
  analysisTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  responseMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing['3xl'] },
  footer: { gap: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  footerButton: { flex: 1, paddingHorizontal: spacing.md },
});
