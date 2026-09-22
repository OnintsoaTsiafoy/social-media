import { Redirect, Tabs } from 'expo-router';

import { TabBar } from '@/components/domain/TabBar';
import { LoadingState } from '@/components/ui';
import { useSession } from '@/store/SessionProvider';
import { palette } from '@/theme';

/**
 * The five main destinations, behind an auth guard. Detail screens live outside
 * this group so they push over the tab bar.
 */
export default function TabsLayout() {
  const { status } = useSession();

  if (status === 'restoring') return <LoadingState label="Chargement de votre espace…" />;
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="publications" options={{ title: 'Publications' }} />
      <Tabs.Screen name="comments" options={{ title: 'Commentaires' }} />
      <Tabs.Screen name="analytics" options={{ title: 'Analytics' }} />
      <Tabs.Screen name="settings" options={{ title: 'Plus' }} />
    </Tabs>
  );
}
