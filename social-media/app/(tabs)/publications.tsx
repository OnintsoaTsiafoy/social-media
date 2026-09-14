import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { PublicationCard } from '@/components/domain/PublicationCard';
import {
  AppHeader,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  IconButton,
  ListFooterLoader,
  Screen,
  SearchField,
  SkeletonList,
  Text,
  useBottomContentInset,
  useFeedback,
} from '@/components/ui';
import { approvalsApi, publicationsApi, type PublicationFilters } from '@/data/api';
import { useSession } from '@/store/SessionProvider';
import { useAsync } from '@/hooks/useAsync';
import { usePaginatedList } from '@/hooks/usePaginatedList';
import { palette, spacing, useResponsive } from '@/theme';
import type { PublicationStatus } from '@/types';

type StatusFilter = 'all' | PublicationStatus;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'scheduled', label: 'Planifiées' },
  { value: 'draft', label: 'Brouillons' },
  { value: 'pending_approval', label: 'À valider' },
  { value: 'approved', label: 'Approuvées' },
  { value: 'rejected', label: 'À corriger' },
  { value: 'published', label: 'Publiées' },
  { value: 'partially_published', label: 'Partielles' },
  { value: 'failed', label: 'Échouées' },
  { value: 'cancelled', label: 'Annulées' },
];

/**
 * ÉCRAN 07 - Liste des publications (`/publications`)
 *
 * Filters persist while the tab stays mounted, the list paginates, and rows
 * de-duplicate - the three points the spec calls out for this screen.
 */
export default function PublicationsScreen() {
  const router = useRouter();
  const { brand } = useSession();
  const canReview = brand?.role === 'OWNER' || brand?.role === 'ADMIN';
  const approvalCount = useAsync(() => canReview && brand
    ? approvalsApi.list({ brandId: brand.id, status: 'pending' }, 0, 1).then((page) => page.total)
    : Promise.resolve(0), [brand?.id, canReview]);
  const { toast } = useFeedback();
  const { gutter } = useResponsive();
  const bottomInset = useBottomContentInset();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [retryingId, setRetryingId] = useState<string | undefined>(undefined);

  const filters: PublicationFilters = { status, search };

  const list = usePaginatedList(
    (page) => publicationsApi.list(filters, page),
    [status, search]
  );
  const counts = useAsync(() => publicationsApi.counts(), []);
  const refreshList = list.refresh, refreshCounts = counts.refresh, refreshApprovals = approvalCount.refresh;
  useFocusEffect(useCallback(() => {
    void refreshList();
    void refreshCounts();
    void refreshApprovals();
  }, [refreshList, refreshCounts, refreshApprovals]));

  const retry = useCallback(
    async (id: string) => {
      setRetryingId(id);
      try {
        const updated = await publicationsApi.retry(id);
        list.patchItem(id, updated);
        void counts.refresh();
        toast('Nouvelle tentative envoyée.', 'success');
      } catch {
        toast('La relance a échoué. Vérifiez le compte social.', 'error');
      } finally {
        setRetryingId(undefined);
      }
    },
    [list, counts, toast]
  );

  const activeFilterCount = (status !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0);

  return (
    <Screen
      flush
      header={
        <>
          <AppHeader
            title="Publications"
            subtitle={list.loading ? undefined : `${list.total} publication${list.total > 1 ? 's' : ''}`}
            actions={
              <>
                <IconButton
                  name="calendar"
                  accessibilityLabel="Ouvrir le calendrier"
                  onPress={() => router.push('/calendar')}
                />
                <IconButton
                  name="add"
                  accessibilityLabel="Nouvelle publication"
                  variant="accent"
                  onPress={() => router.push('/publications/new')}
                />
              </>
            }
          />

          <View style={[styles.searchRow, { paddingHorizontal: gutter }]}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher une publication"
              containerStyle={styles.searchField}
            />
            {activeFilterCount > 0 ? (
              <Button
                label="Réinitialiser"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setStatus('all');
                  setSearch('');
                }}
              />
            ) : null}
          </View>

          {canReview ? <View style={{ paddingHorizontal: gutter, paddingTop: spacing.lg }}>
            <Button label={`Approbations${approvalCount.data === undefined ? '' : ` (${approvalCount.data})`}`}
              variant="secondary" size="sm" onPress={() => router.push('/approvals')} />
            {approvalCount.error ? <Text variant="micro">Compteur indisponible</Text> : null}
          </View> : null}

          <ChipRow gutter={gutter} style={styles.chipRow}>
            {STATUS_FILTERS.map((filter) => (
              <Chip
                key={filter.value}
                label={filter.label}
                count={counts.data?.[filter.value]}
                selected={status === filter.value}
                onPress={() => setStatus(filter.value)}
              />
            ))}
          </ChipRow>
        </>
      }
    >
      {list.loading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonList count={4} />
        </View>
      ) : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={[
            styles.listContent,
            { paddingHorizontal: gutter, paddingBottom: bottomInset },
          ]}
          showsVerticalScrollIndicator={false}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PublicationCard
              publication={item}
              onPress={() => router.push(`/publications/${item.id}`)}
              onRetry={() => retry(item.id)}
              retrying={retryingId === item.id}
            />
          )}
          ListEmptyComponent={
            activeFilterCount > 0 ? (
              <EmptyState
                icon="search"
                title="Aucun résultat"
                message="Aucune publication ne correspond à ces filtres."
                actionLabel="Réinitialiser les filtres"
                onAction={() => {
                  setStatus('all');
                  setSearch('');
                }}
              />
            ) : (
              <EmptyState
                icon="publications"
                title="Aucune publication"
                message="Créez votre première publication et soumettez-la pour approbation."
                actionLabel="Nouvelle publication"
                onAction={() => router.push('/publications/new')}
              />
            )
          }
          ListFooterComponent={
            <>
              <ListFooterLoader visible={list.loadingMore} />
              {list.error && list.items.length > 0 ? (
                <ErrorState compact message={list.error} onRetry={list.reload} style={styles.inlineError} />
              ) : null}
              {!list.hasMore && list.items.length > 0 ? (
                <Text variant="micro" color={palette.inkDisabled} center style={styles.endOfList}>
                  Fin de la liste
                </Text>
              ) : null}
            </>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  searchField: { flex: 1 },
  chipRow: { marginTop: spacing.xl, flexGrow: 0 },
  list: { flex: 1 },
  listContent: { paddingTop: spacing.xl, gap: spacing.lg, flexGrow: 1 },
  inlineError: { marginTop: spacing.xl },
  endOfList: { paddingVertical: spacing['4xl'] },
});
