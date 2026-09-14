import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  ChipWrap,
  Chip,
  DetailRow,
  Divider,
  ErrorState,
  IconButton,
  ListRow,
  MediaPreview,
  MetricCard,
  MetricGrid,
  Screen,
  SkeletonList,
  Text,
  networkMeta,
  publicationStatusMeta,
  targetStatusMeta,
  useFeedback,
} from '@/components/ui';
import { PublicationApprovalPanel } from '@/components/domain/PublicationApprovalPanel';
import { useSession } from '@/store/SessionProvider';
import { approvalsApi, publicationsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import {
  formatDateTime,
  formatDateTimeIn,
  formatMetric,
  formatPercent,
  formatRelative,
  formatTimezone,
} from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { SocialNetwork } from '@/types';

/**
 * ÉCRAN 14 - Détail d’une publication (`/publications/:id`)
 *
 * Shows the per-network outcome, including the failure reason and the retry
 * affordance for just the network that failed.
 */
export default function PublicationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirm, toast } = useFeedback();
  const mutation = useMutation();

  const request = useAsync(() => publicationsApi.get(id), [id]);
  const [retryingNetwork, setRetryingNetwork] = useState<SocialNetwork | undefined>(undefined);

  const publication = request.data;
  const { user } = useSession();
  const [approvalBusy, setApprovalBusy] = useState(false);
  const members = useAsync(() => publication ? approvalsApi.members(publication.brandId) : Promise.resolve([]), [publication?.brandId]);
  const role = members.data?.find((member) => member.id === user?.id)?.role;
  const canWrite = ['owner', 'admin', 'community_manager'].includes(role ?? '');
  const refreshPublication = request.refresh;
  useFocusEffect(useCallback(() => { void refreshPublication(); }, [refreshPublication]));
  const status = publication ? publicationStatusMeta[publication.status] : undefined;

  const retry = async (network?: SocialNetwork) => {
    if (!publication) return;
    setRetryingNetwork(network);
    const result = await mutation.run(() => publicationsApi.retry(publication.id, network));
    setRetryingNetwork(undefined);
    if (!result.ok) return;
    request.setData(result.data);
    toast('Nouvelle tentative lancée. Actualisez pour suivre le résultat.', 'success');
  };

  const publishNow = async () => {
    if (!publication) return;
    const confirmed = await confirm({
      title: 'Publier maintenant ?',
      message: 'La publication sera envoyée immédiatement.',
      confirmLabel: 'Publier',
    });
    if (!confirmed) return;

    const result = await mutation.run(() => publicationsApi.publishNow(publication.id));
    if (!result.ok) return;
    request.setData(result.data);
    // L'envoi est exécuté par le worker : l'écran affiche « en cours » puis
    // l'issue réelle au rafraîchissement.
    toast('Envoi lancé. Actualisez pour suivre le résultat.', 'success');
  };

  const remove = async () => {
    if (!publication) return;
    const confirmed = await confirm({
      title: 'Supprimer cette publication ?',
      message: 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await mutation.run(() => publicationsApi.remove(publication.id));
    if (!result.ok) return;
    toast('Publication supprimée.', 'success');
    router.replace('/publications');
  };

  const cancelSchedule = async () => {
    if (!publication) return;
    const confirmed = await confirm({
      title: 'Annuler la planification ?',
      confirmLabel: 'Annuler la planification',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await mutation.run(() => publicationsApi.cancelSchedule(publication.id));
    if (!result.ok) return;
    request.setData(result.data);
    toast('Planification annulée.', 'success');
  };

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <AppHeader
          title="Publication"
          showBack
          actions={
            publication ? (
              <IconButton
                name="sync"
                accessibilityLabel="Actualiser"
                loading={request.refreshing}
                onPress={request.refresh}
              />
            ) : undefined
          }
        />
      }
      footer={publication ? <DetailActions /> : undefined}
    >
      {request.loading ? (
        <SkeletonList count={3} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : publication && status ? (
        <>
          {/* Section 1 - content */}
          {publication.media ? (
            <MediaPreview uri={publication.media.uri} fileName={publication.media.fileName} height={180} />
          ) : null}

          <Text variant="bodyLg" color={palette.inkBody}>
            {publication.text}
          </Text>

          {publication.hashtags.length > 0 ? (
            <ChipWrap>
              {publication.hashtags.map((hashtag) => (
                <Chip key={hashtag} label={hashtag} variant="tag" />
              ))}
            </ChipWrap>
          ) : null}

          <View style={styles.statusRow}>
            <Badge label={status.label} tone={status.tone} />
            <Text variant="micro" color={palette.inkFaint}>
              {publication.publishedAt
                ? `${formatDateTime(publication.publishedAt)} · par ${publication.authorName}`
                : publication.scheduledAt
                  ? `Planifiée ${formatDateTimeIn(publication.scheduledAt, publication.timezone)}`
                  : `Créée ${formatDateTime(publication.createdAt)}`}
            </Text>
          </View>

          {Object.entries(publication.perNetwork ?? {}).map(([network, content]) => <Card key={network} style={styles.card}>
            <Text variant="eyebrow">Version {network}</Text>
            <Text variant="body">{content?.text}</Text>
            <Text variant="footnote">{content?.hashtags.join(' ')}</Text>
          </Card>)}
          <PublicationApprovalPanel publication={publication} onChange={request.setData} onBusyChange={setApprovalBusy} />

          {/* Section 2 - dates */}
          <Card style={styles.card}>
            <Text variant="eyebrow">Dates</Text>
            <DetailRow label="Création" value={formatDateTime(publication.createdAt)} />
            <Divider />
            <DetailRow label="Dernière modification" value={formatDateTime(publication.updatedAt)} />
            <Divider />
            <DetailRow
              label="Planification"
              value={
                publication.scheduledAt
                  ? formatDateTimeIn(publication.scheduledAt, publication.timezone)
                  : '-'
              }
            />
            <Divider />
            <DetailRow
              label="Publication"
              value={publication.publishedAt ? formatDateTime(publication.publishedAt) : '-'}
            />
            <Divider />
            <DetailRow label="Fuseau horaire" value={formatTimezone(publication.timezone)} />
          </Card>

          {/* Section 4 - per-network outcome */}
          <Card style={styles.card}>
            <Text variant="eyebrow">Résultat par réseau</Text>
            {publication.targets.length === 0 ? (
              <Text variant="footnote" color={palette.inkFaint}>
                Aucun réseau ciblé. Ce brouillon n’a pas encore de destination.
              </Text>
            ) : (
              publication.targets.map((target, index) => {
                const targetStatus = targetStatusMeta[target.status];
                return (
                  <View key={target.network}>
                    {index > 0 ? <Divider style={styles.targetDivider} /> : null}
                    <View style={styles.targetRow}>
                      <View style={styles.targetText}>
                        <Text variant="body" weight="bold">
                          {networkMeta[target.network].label}
                          {target.accountUsername ? ` · ${target.accountUsername}` : ''}
                        </Text>
                        <Text
                          variant="micro"
                          color={target.status === 'failed' ? palette.dangerText : palette.inkFaint}
                          style={styles.targetMeta}
                        >
                          {target.status === 'failed'
                            ? `Échec · ${target.error ?? 'raison inconnue'} · tentative ${target.attempts}`
                            : target.sentAt
                              ? `Envoyée ${formatDateTime(target.sentAt)}${target.externalId ? ` · id ext. ${target.externalId}` : ''}`
                              : 'En attente d’envoi'}
                        </Text>
                      </View>

                      {target.status === 'failed' && publication.approvalValid && canWrite ? (
                        <Button
                          label="Relancer"
                          size="sm"
                          onPress={() => retry(target.network)}
                          loading={retryingNetwork === target.network}
                          style={styles.retryButton}
                        />
                      ) : (
                        <Badge label={targetStatus.label} tone={targetStatus.tone} />
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </Card>

          {/* Section 5 - metrics */}
          <View style={styles.section}>
            <Text variant="eyebrow">Statistiques</Text>
            <MetricGrid>
              <MetricCard
                label="Réactions"
                value={formatMetric(publication.metrics.reactions, { short: true })}
                unavailable={publication.metrics.reactions === null}
                minWidth={100}
              />
              <MetricCard
                label="Commentaires"
                value={formatMetric(publication.metrics.comments, { short: true })}
                unavailable={publication.metrics.comments === null}
                minWidth={100}
              />
              <MetricCard
                label="Partages"
                value={formatMetric(publication.metrics.shares, { short: true })}
                unavailable={publication.metrics.shares === null}
                minWidth={100}
              />
              <MetricCard
                label="Portée"
                value={formatMetric(publication.metrics.reach, { short: true })}
                unavailable={publication.metrics.reach === null}
                minWidth={100}
              />
              <MetricCard
                label="Impressions"
                value={formatMetric(publication.metrics.impressions, { short: true })}
                unavailable={publication.metrics.impressions === null}
                minWidth={100}
              />
              <MetricCard
                label="Engagement"
                value={formatPercent(publication.metrics.engagementRate)}
                unavailable={publication.metrics.engagementRate === null}
                minWidth={100}
              />
            </MetricGrid>
            <Text variant="micro" color={palette.inkDisabled}>
              {publication.metrics.lastSyncAt
                ? `Dernière synchronisation : ${formatRelative(publication.metrics.lastSyncAt)}`
                : 'Pas encore de statistiques - elles arrivent après la publication.'}
            </Text>
          </View>

          {/* Section 6 - related comments */}
          <Card padded={false}>
            <ListRow
              label={`${publication.commentCount} commentaire${publication.commentCount > 1 ? 's' : ''} lié${publication.commentCount > 1 ? 's' : ''}`}
              description={`${publication.negativeCommentCount} négatif${publication.negativeCommentCount > 1 ? 's' : ''} · ${publication.urgentCommentCount} urgent${publication.urgentCommentCount > 1 ? 's' : ''}`}
              onPress={() => router.push('/comments')}
            />
          </Card>

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
        </>
      ) : null}
    </Screen>
  );

  /** Footer actions depend on the status, as tabulated in the spec. */
  function DetailActions() {
    if (!publication || !canWrite || approvalBusy) return null;

    switch (publication.status) {
      case 'pending_approval':
      case 'rejected':
        return null;
      case 'draft':
        return <View style={styles.footerRow}>
          <Button label="Modifier" variant="secondary" onPress={() => router.push(`/publications/${publication.id}/edit`)} style={styles.footerButton} />
          <Button label="Supprimer" variant="danger" onPress={remove} disabled={mutation.pending} />
        </View>;
      case 'approved':
        return (
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Button
                label="Modifier"
                variant="secondary"
                size="sm"
                onPress={() => router.push(`/publications/${publication.id}/edit`)}
                style={styles.footerButton}
              />
              <Button
                label="Planifier"
                variant="accent"
                size="sm"
                onPress={() => router.push(`/publications/${publication.id}/schedule`)}
                style={styles.footerButton}
              />
            </View>
            <View style={styles.footerRow}>
              <Button
                label="Publier maintenant"
                onPress={publishNow}
                loading={mutation.pending && !retryingNetwork}
                style={styles.footerButton}
              />
              <Button label="Supprimer" variant="danger" size="sm" onPress={remove} />
            </View>
          </View>
        );

      case 'scheduled':
        return (
          <View style={styles.footerRow}>
            <Button
              label="Modifier"
              variant="secondary"
              onPress={() => router.push(`/publications/${publication.id}/edit`)}
              style={styles.footerButton}
            />
            <Button
              label="Annuler"
              variant="danger"
              onPress={cancelSchedule}
              loading={mutation.pending}
              style={styles.footerButton}
            />
          </View>
        );

      case 'failed':
      case 'partially_published':
        return (
          <View style={styles.footerRow}>
            <Button
              label="Modifier"
              variant="secondary"
              disabled={publication.status === 'partially_published'}
              onPress={() => router.push(`/publications/${publication.id}/edit`)}
              style={styles.footerButton}
            />
            <Button
              label="Relancer"
              disabled={!publication.approvalValid}
              onPress={() => retry()}
              loading={mutation.pending && retryingNetwork === undefined}
              style={styles.footerButton}
            />
          </View>
        );

      case 'cancelled':
        return (
          <View style={styles.footerRow}>
            <Button
              label="Dupliquer"
              variant="secondary"
              onPress={() => router.push('/publications/new')}
              style={styles.footerButton}
            />
            <Button label="Supprimer" variant="danger" onPress={remove} style={styles.footerButton} />
          </View>
        );

      default:
        return (
          <View style={styles.footerRow}>
            <Button
              label="Commentaires"
              variant="secondary"
              onPress={() => router.push('/comments')}
              style={styles.footerButton}
            />
            <Button
              label="Analytics"
              onPress={() => router.push(`/analytics/publications/${publication.id}`)}
              style={styles.footerButton}
            />
          </View>
        );
    }
  }
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, flexWrap: 'wrap' },
  section: { gap: spacing.xl },
  card: { gap: spacing.xl },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  targetText: { flex: 1 },
  targetMeta: { marginTop: 2 },
  targetDivider: { marginVertical: spacing.xl },
  retryButton: { paddingHorizontal: spacing['3xl'] },
  footer: { gap: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.lg },
  footerButton: { flex: 1 },
});
