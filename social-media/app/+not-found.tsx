import { useRouter } from 'expo-router';

import { Button, EmptyState, Screen } from '@/components/ui';

/** Fallback for an unknown deep link. */
export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <Screen centred>
      <EmptyState
        icon="search"
        title="Page introuvable"
        message="Ce lien ne correspond à aucun écran de l’application. Il a peut-être expiré."
      />
      <Button label="Retour à l’accueil" onPress={() => router.replace('/home')} block />
    </Screen>
  );
}
