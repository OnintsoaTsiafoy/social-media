import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppHeader, Badge, Button, Card, ErrorState, Screen, SkeletonList, Text } from '@/components/ui';
import { knowledgeApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';
import { spacing } from '@/theme';

const statusLabels = { PENDING: 'En attente', INDEXING: 'Indexation en cours', READY: 'Disponible', FAILED: 'Échec d’indexation' };

export default function KnowledgeScreen() {
  const router = useRouter();
  const { brand } = useSession();
  const [page, setPage] = useState(1);
  const request = useAsync(() => brand ? knowledgeApi.list(brand.id, page) : Promise.resolve(null), [brand?.id, page]);
  const { reload } = request;
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useEffect(() => { setPage(1); }, [brand?.id]);
  useEffect(() => {
    if (!request.data?.items.some((item) => ['INDEXING', 'PENDING'].includes(item.status))) return;
    const timer = setTimeout(request.reload, 3000);
    return () => clearTimeout(timer);
  }, [request.data, request.reload]);

  return (
    <Screen scroll header={<AppHeader title="Base de connaissances" showBack />}>
      <Text>Ajoutez les FAQ, produits, horaires et règles de votre marque pour guider les réponses.</Text>
      <Button label="Ajouter un document" onPress={() => router.push('/knowledge/new')} disabled={!brand || brand.role === 'VIEWER'} />
      <Button label="Actualiser" variant="secondary" onPress={request.reload} disabled={request.loading} />
      {!brand ? <Text>Sélectionnez une marque dans les paramètres.</Text> : null}
      {request.loading ? <SkeletonList count={3} /> : request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : null}
      {!request.loading && request.data?.items.length === 0 ? <Text>Aucun document. Commencez par une FAQ ou un texte.</Text> : null}
      {request.data?.items.map((item) => (
        <Card key={item.id}>
          <View style={{ gap: spacing.md }}>
            <Text weight="bold">{item.title}</Text>
            <Badge label={statusLabels[item.status]} tone={item.status === 'READY' ? 'success' : item.status === 'FAILED' ? 'danger' : 'warning'} />
            <Text variant="footnote">{item.documentType} · {item.chunkCount} passages · {item.internal ? 'Interne' : 'Utilisable pour les réponses'}</Text>
            {item.error ? <Text variant="footnote">{item.error}</Text> : null}
            <Button label="Ouvrir" variant="secondary" size="sm" onPress={() => router.push(`/knowledge/${item.id}`)} />
          </View>
        </Card>
      ))}
      {request.data && request.data.total > request.data.pageSize ? (
        <View style={{ gap: spacing.md }}>
          <Text>Page {page} sur {Math.ceil(request.data.total / request.data.pageSize)}</Text>
          <Button label="Précédente" variant="secondary" disabled={page === 1} onPress={() => setPage(page - 1)} />
          <Button label="Suivante" variant="secondary" disabled={page * request.data.pageSize >= request.data.total} onPress={() => setPage(page + 1)} />
        </View>
      ) : null}
    </Screen>
  );
}
