import { useLocalSearchParams } from 'expo-router';
import { AppHeader, Button, Card, EmptyState, ErrorState, Screen, SkeletonList, Text, publicationStatusMeta } from '@/components/ui';
import { approvalsApi } from '@/data/api';
import { usePaginatedList } from '@/hooks/usePaginatedList';
import { formatDateTime } from '@/lib/format';
import { spacing } from '@/theme';

const labels: Record<string, string> = {
  created: 'Créée', updated: 'Modifiée', deleted: 'Supprimée', request_approval: 'Soumise pour approbation',
  approve: 'Approuvée', reject: 'Refusée', request_changes: 'Modifications demandées', cancel_approval: 'Demande annulée',
  scheduled: 'Planifiée', schedule_cancelled: 'Planification annulée', publish_requested: 'Envoi demandé',
  retry_requested: 'Relance demandée', job_cancelled: 'Envoi annulé', delivery_completed: 'Envoi terminé',
};

export default function ApprovalHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = usePaginatedList((page) => approvalsApi.history(id, page), [id]);
  return <Screen scroll header={<AppHeader title="Historique de la publication" showBack />} refreshing={list.refreshing} onRefresh={list.refresh}>
    {list.loading ? <SkeletonList count={3} /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : <>
      {!list.items.length ? <EmptyState title="Aucune action enregistrée" icon="clock" /> : null}
      {list.items.map((event) => <Card key={event.id} style={{ gap: spacing.md }}>
        <Text variant="body" weight="bold">{labels[event.action.replace('publication.', '')] ?? event.action} · {event.actorName}</Text>
        <Text variant="micro">{formatDateTime(event.timestamp)}</Text>
        {event.fromStatus || event.toStatus ? <Text variant="footnote">{event.fromStatus ? publicationStatusMeta[event.fromStatus].label : 'Création'} → {event.toStatus ? publicationStatusMeta[event.toStatus].label : '—'}</Text> : null}
        {event.comment ? <Text variant="body">{event.comment}</Text> : null}
      </Card>)}
      {list.hasMore ? <Button label="Voir les actions précédentes" variant="secondary" onPress={list.loadMore} loading={list.loadingMore} /> : null}
    </>}
  </Screen>;
}
