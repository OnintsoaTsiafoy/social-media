import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CompetitorRow } from '@/components/domain/CompetitorCard';
import {
  AppHeader,
  Button,
  Callout,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Screen,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { competitorsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';
import { spacing, useResponsive } from '@/theme';
import type { SocialNetwork } from '@/types';

/**
 * Concurrents suivis (`/competitors`).
 *
 * Un concurrent inaccessible n'est pas masqué : il reste listé avec son statut
 * et ses dernières données connues (section 11 du TODO analyse
 * concurrentielle). Cacher la ligne ferait disparaître l'explication avec elle.
 */
export default function CompetitorsScreen() {
  const router = useRouter();
  const { gutter } = useResponsive();
  const { brand } = useSession();
  const { toast, confirm } = useFeedback();

  const [platform, setPlatform] = useState<SocialNetwork | 'all'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const syncing = useMutation();
  const removing = useMutation();

  const request = useAsync(
    () => (brand ? competitorsApi.list(brand.id, { platform }) : Promise.resolve(null)),
    [brand?.id, platform]
  );
  const { reload } = request;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const canManage = Boolean(brand && brand.role !== 'VIEWER');

  async function onSync(id: string) {
    if (!brand) return;
    setBusyId(id);
    const result = await syncing.run(() => competitorsApi.sync(brand.id, id));
    setBusyId(null);
    if (result.ok) {
      // 202 : rien n'est encore collecté au retour de l'appel. Le message le
      // dit plutôt que de laisser croire à un rafraîchissement immédiat.
      toast('Synchronisation demandée. Les données seront mises à jour sous peu.');
    } else if (result.error) {
      toast(result.error, 'error');
    }
  }

  async function onRemove(id: string) {
    if (!brand) return;
    const confirmed = await confirm({
      title: 'Retirer ce concurrent ?',
      message: 'Les publications et relevés déjà collectés seront supprimés avec lui.',
      confirmLabel: 'Retirer',
      destructive: true,
    });
    if (!confirmed) return;

    setBusyId(id);
    const result = await removing.run(() => competitorsApi.remove(brand.id, id));
    setBusyId(null);
    if (result.ok) {
      toast('Concurrent retiré.');
      reload();
    } else if (result.error) {
      toast(result.error, 'error');
    }
  }

  const items = request.data?.items ?? [];

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <>
          <AppHeader title="Concurrents" showBack />
          <ChipRow gutter={gutter} style={styles.chipRow}>
            <Chip label="Tous réseaux" selected={platform === 'all'} onPress={() => setPlatform('all')} />
            <Chip label="Facebook" selected={platform === 'facebook'} onPress={() => setPlatform('facebook')} />
            <Chip label="Instagram" selected={platform === 'instagram'} onPress={() => setPlatform('instagram')} />
          </ChipRow>
        </>
      }
      footer={
        canManage ? (
          <Button label="Ajouter un concurrent" block onPress={() => router.push('/competitors/new')} />
        ) : undefined
      }
    >
      {!brand ? <Text>Sélectionnez une marque dans les paramètres.</Text> : null}

      <Text variant="footnote">
        Seules les données publiques accessibles via les API officielles Meta sont collectées. Certaines métriques
        peuvent rester indisponibles selon le type de compte et les autorisations obtenues.
      </Text>

      <Button
        label="Comparer avec ma marque"
        variant="secondary"
        onPress={() => router.push('/analytics/competitors')}
        disabled={items.length === 0}
      />

      {request.loading ? <SkeletonList count={3} /> : null}
      {request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : null}

      {!request.loading && !request.error && items.length === 0 ? (
        <EmptyState
          title="Aucun concurrent suivi"
          message="Ajoutez une Page Facebook ou un compte Instagram professionnel pour comparer vos performances publiques."
        />
      ) : null}

      {items.map((competitor) => (
        <CompetitorRow
          key={competitor.id}
          competitor={competitor}
          canManage={canManage}
          syncing={syncing.pending && busyId === competitor.id}
          removing={removing.pending && busyId === competitor.id}
          onOpen={() => router.push(`/competitors/${competitor.id}`)}
          onSync={() => onSync(competitor.id)}
          onRemove={() => onRemove(competitor.id)}
        />
      ))}

      {items.some((competitor) => competitor.status === 'permission_required') ? (
        <Callout tone="warning" title="Autorisation Meta en attente">
          Certains concurrents nécessitent une autorisation Meta que l’application n’a pas encore obtenue. Les dernières
          données connues restent affichées avec leur date.
        </Callout>
      ) : null}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { paddingBottom: spacing.md },
});
