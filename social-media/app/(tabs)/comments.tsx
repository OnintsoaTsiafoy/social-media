import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { CommentCard } from '@/components/domain/CommentCard';
import {
  AppHeader,
  BottomSheet,
  Button,
  Chip,
  ChipRow,
  ChipWrap,
  EmptyState,
  ErrorState,
  IconButton,
  ListFooterLoader,
  Screen,
  SearchField,
  SegmentedControl,
  SkeletonList,
  Text,
  useBottomContentInset,
  useFeedback,
} from '@/components/ui';
import { commentsApi, type CommentFilters } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { usePaginatedList } from '@/hooks/usePaginatedList';
import { palette, spacing, useResponsive } from '@/theme';
import type { CommentStatus, Intent, Priority, Sentiment, SocialNetwork } from '@/types';

type Quick = 'new' | 'priority' | 'negative' | 'treated' | 'all';

const QUICK_FILTERS: { value: Quick; label: string }[] = [
  { value: 'new', label: 'Nouveaux' },
  { value: 'priority', label: 'Prioritaires' },
  { value: 'negative', label: 'Négatifs' },
  { value: 'treated', label: 'Traités' },
  { value: 'all', label: 'Tous' },
];

/** Maps a quick filter onto the API's filter shape. */
function quickToFilters(quick: Quick): CommentFilters {
  switch (quick) {
    case 'new':
      return { status: 'new' };
    case 'priority':
      return { priority: 'high' };
    case 'negative':
      return { sentiment: 'negative' };
    case 'treated':
      return { status: 'treated' };
    default:
      return {};
  }
}

/**
 * ÉCRAN 17 - Boîte de réception des commentaires (`/comments`)
 *
 * Sorted most-recent-first by default, with a priority sort, quick filters, an
 * advanced filter sheet, and pagination.
 */
export default function CommentsScreen() {
  const router = useRouter();
  const { toast } = useFeedback();
  const { gutter } = useResponsive();
  const bottomInset = useBottomContentInset();

  const [quick, setQuick] = useState<Quick>('new');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'priority'>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [network, setNetwork] = useState<SocialNetwork | 'all'>('all');
  const [sentiment, setSentiment] = useState<Sentiment | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [intent, setIntent] = useState<Intent | 'all'>('all');
  const [status, setStatus] = useState<CommentStatus | 'all'>('all');
  const [syncing, setSyncing] = useState(false);

  const filters: CommentFilters = {
    ...quickToFilters(quick),
    search,
    sort,
    ...(network !== 'all' ? { network } : {}),
    ...(sentiment !== 'all' ? { sentiment } : {}),
    ...(priority !== 'all' ? { priority } : {}),
    ...(intent !== 'all' ? { intent } : {}),
    ...(status !== 'all' ? { status } : {}),
  };

  const list = usePaginatedList(
    (page) => commentsApi.list(filters, page),
    [quick, search, sort, network, sentiment, priority, intent, status]
  );
  const counts = useAsync(() => commentsApi.counts(), []);

  const advancedCount =
    (network !== 'all' ? 1 : 0) +
    (sentiment !== 'all' ? 1 : 0) +
    (priority !== 'all' ? 1 : 0) +
    (intent !== 'all' ? 1 : 0) +
    (status !== 'all' ? 1 : 0);

  const resetAdvanced = () => {
    setNetwork('all');
    setSentiment('all');
    setPriority('all');
    setIntent('all');
    setStatus('all');
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await commentsApi.sync();
      list.reload();
      void counts.refresh();
      toast('Commentaires synchronisés.', 'success');
    } catch {
      toast('Synchronisation impossible : un compte doit être reconnecté.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen
      flush
      header={
        <>
          <AppHeader
            title="Commentaires"
            subtitle={
              counts.data
                ? `${counts.data.untreated} non traités · ${counts.data.highPriority} prioritaires`
                : undefined
            }
            actions={
              <>
                <IconButton
                  name="sync"
                  accessibilityLabel="Synchroniser les commentaires"
                  loading={syncing}
                  onPress={sync}
                />
                <IconButton
                  name="filter"
                  accessibilityLabel={`Filtres${advancedCount > 0 ? `, ${advancedCount} actifs` : ''}`}
                  badgeCount={advancedCount}
                  onPress={() => setFiltersOpen(true)}
                />
              </>
            }
          />

          <View style={[styles.toolRow, { paddingHorizontal: gutter }]}>
            <SearchField
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher un auteur ou un texte"
              containerStyle={styles.searchField}
            />
          </View>

          <View style={[styles.sortRow, { paddingHorizontal: gutter }]}>
            <SegmentedControl
              label="Tri des commentaires"
              value={sort}
              options={[
                { value: 'recent', label: 'Récents' },
                { value: 'priority', label: 'Priorité' },
              ]}
              onChange={setSort}
            />
          </View>

          <ChipRow gutter={gutter} style={styles.chipRow}>
            {QUICK_FILTERS.map((filter) => (
              <Chip
                key={filter.value}
                label={filter.label}
                selected={quick === filter.value}
                onPress={() => setQuick(filter.value)}
              />
            ))}
          </ChipRow>
        </>
      }
    >
      {list.loading ? (
        <View style={{ paddingHorizontal: gutter }}>
          <SkeletonList count={4} withThumbnail={false} />
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
            <CommentCard comment={item} onPress={() => router.push(`/comments/${item.id}`)} />
          )}
          ListEmptyComponent={
            search || advancedCount > 0 || quick !== 'all' ? (
              <EmptyState
                icon="search"
                title="Aucun résultat"
                message="Aucun commentaire ne correspond à ces critères."
                actionLabel="Voir tous les commentaires"
                onAction={() => {
                  setQuick('all');
                  setSearch('');
                  resetAdvanced();
                }}
              />
            ) : (
              <EmptyState
                icon="comments"
                title="Aucun commentaire"
                message="Synchronisez vos comptes pour importer les commentaires Facebook et Instagram."
                actionLabel="Synchroniser"
                onAction={sync}
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

      <BottomSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtres"
        headerAction={
          advancedCount > 0 ? (
            <Button label="Réinitialiser" variant="ghost" size="sm" onPress={resetAdvanced} />
          ) : undefined
        }
        footer={
          <Button label="Appliquer" onPress={() => setFiltersOpen(false)} block />
        }
      >
        <View style={styles.filterBody}>
          <FilterGroup label="Réseau">
            <Chip label="Tous" variant="choice" selected={network === 'all'} onPress={() => setNetwork('all')} />
            <Chip
              label="Facebook"
              variant="choice"
              selected={network === 'facebook'}
              onPress={() => setNetwork('facebook')}
            />
            <Chip
              label="Instagram"
              variant="choice"
              selected={network === 'instagram'}
              onPress={() => setNetwork('instagram')}
            />
          </FilterGroup>

          <FilterGroup label="Sentiment">
            <Chip label="Tous" variant="choice" selected={sentiment === 'all'} onPress={() => setSentiment('all')} />
            <Chip
              label="Positif"
              variant="choice"
              selected={sentiment === 'positive'}
              onPress={() => setSentiment('positive')}
            />
            <Chip
              label="Neutre"
              variant="choice"
              selected={sentiment === 'neutral'}
              onPress={() => setSentiment('neutral')}
            />
            <Chip
              label="Négatif"
              variant="choice"
              selected={sentiment === 'negative'}
              onPress={() => setSentiment('negative')}
            />
          </FilterGroup>

          <FilterGroup label="Priorité">
            <Chip label="Toutes" variant="choice" selected={priority === 'all'} onPress={() => setPriority('all')} />
            <Chip label="Faible" variant="choice" selected={priority === 'low'} onPress={() => setPriority('low')} />
            <Chip
              label="Moyenne"
              variant="choice"
              selected={priority === 'medium'}
              onPress={() => setPriority('medium')}
            />
            <Chip label="Élevée" variant="choice" selected={priority === 'high'} onPress={() => setPriority('high')} />
          </FilterGroup>

          <FilterGroup label="Intention">
            <Chip label="Toutes" variant="choice" selected={intent === 'all'} onPress={() => setIntent('all')} />
            <Chip
              label="Question"
              variant="choice"
              selected={intent === 'question'}
              onPress={() => setIntent('question')}
            />
            <Chip
              label="Plainte"
              variant="choice"
              selected={intent === 'complaint'}
              onPress={() => setIntent('complaint')}
            />
            <Chip
              label="Réclamation"
              variant="choice"
              selected={intent === 'claim'}
              onPress={() => setIntent('claim')}
            />
            <Chip
              label="Demande d’info"
              variant="choice"
              selected={intent === 'info_request'}
              onPress={() => setIntent('info_request')}
            />
          </FilterGroup>

          <FilterGroup label="Statut">
            <Chip label="Tous" variant="choice" selected={status === 'all'} onPress={() => setStatus('all')} />
            <Chip label="Nouveaux" variant="choice" selected={status === 'new'} onPress={() => setStatus('new')} />
            <Chip
              label="Non traités"
              variant="choice"
              selected={status === 'untreated'}
              onPress={() => setStatus('untreated')}
            />
            <Chip
              label="Traités"
              variant="choice"
              selected={status === 'treated'}
              onPress={() => setStatus('treated')}
            />
            <Chip
              label="Ignorés"
              variant="choice"
              selected={status === 'ignored'}
              onPress={() => setStatus('ignored')}
            />
            <Chip
              label="Escaladés"
              variant="choice"
              selected={status === 'escalated'}
              onPress={() => setStatus('escalated')}
            />
          </FilterGroup>
        </View>
      </BottomSheet>
    </Screen>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.filterGroup}>
      <Text variant="eyebrow">{label}</Text>
      <ChipWrap>{children}</ChipWrap>
    </View>
  );
}

const styles = StyleSheet.create({
  toolRow: { flexDirection: 'row', gap: spacing.lg },
  searchField: { flex: 1 },
  sortRow: { marginTop: spacing.xl },
  chipRow: { marginTop: spacing.xl, flexGrow: 0 },
  list: { flex: 1 },
  listContent: { paddingTop: spacing.xl, gap: spacing.lg, flexGrow: 1 },
  inlineError: { marginTop: spacing.xl },
  endOfList: { paddingVertical: spacing['4xl'] },
  filterBody: { gap: spacing['3xl'] },
  filterGroup: { gap: spacing.xl },
});
