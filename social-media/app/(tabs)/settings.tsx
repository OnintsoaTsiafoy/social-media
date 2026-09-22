import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Badge,
  Card,
  Divider,
  ListRow,
  Screen,
  SegmentedControl,
  Text,
  useFeedback,
} from '@/components/ui';
import { accountsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { LANGUAGE_OPTIONS, TIMEZONE_OPTIONS } from '@/data/options';
import { useSession } from '@/store/SessionProvider';
import { useTheme } from '@/store/ThemeProvider';
import { palette, spacing, type ThemePreference } from '@/theme';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

/**
 * ÉCRAN 26 - Paramètres généraux (`/settings`)
 *
 * The "Plus" tab. Groups every secondary destination, and flags accounts that
 * need attention so the user does not have to go looking.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { user, brand, signOut } = useSession();
  const { confirm, toast } = useFeedback();
  const { preference, setPreference } = useTheme();

  const accounts = useAsync(() => accountsApi.list(brand?.id ?? '', brand?.name ?? ''), []);

  const needsReconnect = (accounts.data ?? []).filter(
    (account) => account.status !== 'connected' && account.status !== 'expiring'
  ).length;

  const languageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === user?.language)?.label ?? 'Français';
  const timezoneLabel =
    TIMEZONE_OPTIONS.find((option) => option.value === user?.timezone)?.label ?? 'UTC+1 · Paris';

  const handleSignOut = async () => {
    const confirmed = await confirm({
      title: 'Se déconnecter ?',
      message: 'Vous devrez saisir vos identifiants pour revenir sur votre espace.',
      confirmLabel: 'Se déconnecter',
      destructive: true,
    });
    if (!confirmed) return;

    await signOut();
    toast('Vous avez été déconnecté.', 'info');
    router.replace('/login');
  };

  return (
    <Screen scroll header={<AppHeader title="Plus" />}>
      <Group label="Compte">
        <ListRow label="Profil" description={user?.email} onPress={() => router.push('/profile')} />
        <Divider />
        <ListRow label="Sécurité & mot de passe" onPress={() => router.push('/settings/security')} />
      </Group>

      <Group label="Marque & IA">
        <ListRow label="Marque & ton IA" onPress={() => router.push('/settings/brand')} />
        <Divider />
        <ListRow label="Base de connaissances" onPress={() => router.push('/knowledge')} />
        <Divider />
        <ListRow label="Qualité des réponses IA" onPress={() => router.push('/ai-feedback')} />
        <Divider />
        <ListRow
          label="Comptes sociaux"
          onPress={() => router.push('/settings/social-accounts')}
          showChevron={needsReconnect === 0}
          trailing={
            needsReconnect > 0 ? (
              <Badge label={`${needsReconnect} à reconnecter`} tone="warning" />
            ) : undefined
          }
        />
      </Group>

      <View style={styles.group}>
        <Text variant="eyebrow">Apparence</Text>
        <SegmentedControl
          label="Thème de l’application"
          value={preference}
          options={THEME_OPTIONS}
          onChange={setPreference}
        />
        <Text variant="footnote" color={palette.inkMuted}>
          « Système » suit le mode clair ou sombre du téléphone.
        </Text>
      </View>

      <Group label="Préférences">
        <ListRow label="Notifications" onPress={() => router.push('/settings/notifications')} />
        <Divider />
        <ListRow label="Langue" value={languageLabel} onPress={() => router.push('/profile')} />
        <Divider />
        <ListRow label="Fuseau horaire" value={timezoneLabel} onPress={() => router.push('/profile')} />
        <Divider />
        <ListRow label="Calendrier éditorial" onPress={() => router.push('/calendar')} />
      </Group>

      <Group label="Confidentialité">
        <ListRow label="Conditions d’utilisation" onPress={() => router.push('/legal/terms')} />
        <Divider />
        <ListRow label="Politique de confidentialité" onPress={() => router.push('/legal/privacy')} />
        <Divider />
        <ListRow
          label="Supprimer mon compte"
          tone="danger"
          onPress={() => router.push('/settings/delete-account')}
        />
      </Group>

      <Group label="Session">
        <ListRow label="Se déconnecter" tone="danger" onPress={handleSignOut} showChevron={false} />
      </Group>

      <View style={styles.about}>
        <Text variant="micro" color={palette.inkDisabled} center>
          Hootly · version 1.0.0
        </Text>
        <Text variant="micro" color={palette.inkDisabled} center>
          Support : support@hootly.app · Documentation et licences dans l’application
        </Text>
      </View>
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="eyebrow">{label}</Text>
      <Card padded={false}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xl },
  about: { gap: spacing.sm, paddingTop: spacing.xl },
});
