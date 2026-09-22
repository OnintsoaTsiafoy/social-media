import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/store/SessionProvider';
import { palette } from '@/theme';

/** Auth group. A signed-in user is bounced to the dashboard. */
export default function AuthLayout() {
  const { status } = useSession();

  if (status === 'signedIn') return <Redirect href="/home" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  );
}
