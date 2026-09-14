import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';

import { PublicationApprovalPanel, approvalLabels } from '@/components/domain/PublicationApprovalPanel';
import { AppHeader, Badge, Button, Card, EmptyState, ErrorState, MediaPreview, Screen, SelectField, SkeletonList, Text, networkMeta } from '@/components/ui';
import { approvalsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { usePaginatedList } from '@/hooks/usePaginatedList';
import { formatDateTimeIn } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { spacing } from '@/theme';
import type { ApprovalStatus } from '@/types';

export default function ApprovalsScreen() {
  const { brand } = useSession();
  const router = useRouter();
  const canReview = brand?.role === 'ADMIN' || brand?.role === 'OWNER';
  const [status, setStatus] = useState<ApprovalStatus | 'all'>('pending');
  const [authorId, setAuthorId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const members = useAsync(() => brand && canReview ? approvalsApi.members(brand.id) : Promise.resolve([]), [brand?.id, canReview]);
  const list = usePaginatedList((page) => brand && canReview
    ? approvalsApi.list({ brandId: brand.id, status, authorId: authorId || undefined, reviewerId: reviewerId || undefined }, page)
    : Promise.resolve({ items: [], total: 0, hasMore: false }), [brand?.id, canReview, status, authorId, reviewerId]);
  const refreshList = list.refresh;
  useFocusEffect(useCallback(() => { void refreshList(); }, [refreshList]));
  return <Screen flush header={<AppHeader title="Approbations" showBack subtitle={brand?.name} />}>
    {!canReview ? <EmptyState title="Accès réservé aux responsables" message="Un administrateur ou propriétaire peut traiter les demandes de cette marque." icon="lock" /> : <>
      <View style={{ padding: spacing.xl, gap: spacing.lg }}>
        <SelectField label="Statut" value={status} onChange={setStatus}
          options={[{ value: 'all', label: 'Tous les statuts' }, ...Object.entries(approvalLabels).map(([value, label]) => ({ value: value as ApprovalStatus, label }))]} />
        <SelectField label="Auteur" value={authorId} onChange={setAuthorId} options={[{ value: '', label: 'Tous les auteurs' }, ...(members.data ?? []).map((member) => ({ value: member.id, label: member.displayName }))]} />
        <SelectField label="Reviewer" value={reviewerId} onChange={setReviewerId} options={[{ value: '', label: 'Tous les responsables' }, ...(members.data ?? []).filter((member) => ['admin', 'owner'].includes(member.role)).map((member) => ({ value: member.id, label: member.displayName }))]} />
        <Text variant="micro">{list.total} demande{list.total > 1 ? 's' : ''}</Text>
        {members.error ? <ErrorState compact message={members.error} onRetry={members.reload} /> : null}
      </View>
      {list.loading ? <SkeletonList count={3} /> : list.error && !list.items.length ? <ErrorState message={list.error} onRetry={list.reload} /> :
        <FlatList data={list.items} keyExtractor={(item) => item.id} refreshing={list.refreshing} onRefresh={list.refresh}
          onEndReached={list.loadMore} onEndReachedThreshold={0.3} contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl }}
          renderItem={({ item }) => <Card style={{ gap: spacing.lg }}>
            <Badge label={approvalLabels[item.status]} tone={item.status === 'pending' ? 'warning' : 'neutral'} />
            <Text variant="body" weight="bold">{item.publication.authorName}</Text>
            <Text variant="footnote">{item.publication.targets.map((target) => networkMeta[target.network].label).join(' · ')}</Text>
            <Text variant="micro">{item.publication.scheduledAt ? `Prévue le ${formatDateTimeIn(item.publication.scheduledAt, item.publication.timezone)}` : 'Date de publication à définir après validation'}</Text>
            {item.publication.media ? <MediaPreview uri={item.publication.media.uri} fileName={item.publication.media.fileName} height={180} /> : null}
            <Text variant="body">{item.publication.text}</Text>
            <Text variant="footnote">{item.publication.hashtags.join(' ')}</Text>
            {Object.entries(item.publication.perNetwork ?? {}).map(([network, content]) => <View key={network}>
              <Text variant="eyebrow">Version {network}</Text><Text variant="body">{content?.text}</Text><Text variant="footnote">{content?.hashtags.join(' ')}</Text>
            </View>)}
            {item.status === 'pending' && item.publication.approval?.id === item.id
              ? <PublicationApprovalPanel publication={item.publication} onChange={() => { void list.refresh(); }} />
              : <><Text variant="footnote">Responsable : {item.reviewerName ?? 'Tous les responsables'}</Text>{item.comment ? <Text variant="body">{item.comment}</Text> : null}</>}
            <Button label="Voir la publication" variant="secondary" size="sm" onPress={() => router.push(`/publications/${item.publication.id}`)} />
          </Card>}
          ListEmptyComponent={<EmptyState title="Aucune demande" message="Aucune demande ne correspond aux filtres." icon="checkCircle" />}
          ListFooterComponent={list.hasMore ? <Button label="Voir plus" onPress={list.loadMore} loading={list.loadingMore} /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null} />}
    </>}
  </Screen>;
}
