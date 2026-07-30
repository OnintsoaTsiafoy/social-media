import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  Icon,
  Screen,
  Text,
  networkMeta,
} from '@/components/ui';
import { palette, radius, spacing } from '@/theme';
import type { SocialNetwork } from '@/types';

type Status = 'success' | 'cancelled' | 'error';

/** Provider error codes mapped to copy the user can act on. */
const ERROR_COPY: Record<string, { title: string; message: string }> = {
  permission_denied: {
    title: 'Permission refusée',
    message:
      'Les autorisations nécessaires n’ont pas été accordées. Relancez la connexion et acceptez les permissions de publication et de lecture des commentaires.',
  },
  incompatible_account: {
    title: 'Compte incompatible',
    message:
      'Ce compte Instagram n’est pas un compte professionnel, ou la page Facebook n’est pas administrée par votre compte.',
  },
  session_expired: {
    title: 'Session expirée',
    message: 'Votre session a expiré pendant la connexion. Reconnectez-vous puis réessayez.',
  },
  invalid_state: {
    title: 'État de sécurité invalide',
    message:
      'La vérification de sécurité a échoué. Par précaution, la connexion a été interrompue. Relancez-la depuis l’application.',
  },
  provider_error: {
    title: 'Erreur du fournisseur',
    message: 'Le réseau social a renvoyé une erreur. Réessayez dans quelques instants.',
  },
};

/**
 * ÉCRAN 16 - Retour OAuth (`/oauth/callback`)
 *
 * Deep-link landing page. Only a non-sensitive status is carried in the link -
 * the token is exchanged and stored server-side, never passed through the URL.
 */
export default function OAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    status?: Status;
    network?: SocialNetwork;
    account?: string;
    reason?: string;
  }>();

  const status: Status = params.status ?? 'error';
  const network = params.network;
  const networkLabel = network ? networkMeta[network].label : 'Réseau social';

  const goToAccounts = () => router.replace('/settings/social-accounts');

  if (status === 'success') {
    return (
      <Screen centred>
        <View style={styles.content}>
          <View style={[styles.icon, styles.iconSuccess]}>
            <Icon name="check" size={30} color={palette.night} />
          </View>

          <Text variant="title1" weight="extrabold" center>
            Compte connecté
          </Text>
          <Text variant="footnote" color={palette.inkFaint} center style={styles.message}>
            {networkLabel}
            {params.account ? ` · ${params.account}` : ''} est maintenant relié à votre marque.
          </Text>

          <Card style={styles.permissionsCard}>
            <Text variant="eyebrow">Permissions obtenues</Text>
            <Permission granted label="Publier du contenu" />
            <Permission granted label="Lire les commentaires" />
            <Permission granted label="Répondre aux commentaires" />
            <Permission granted={false} label="Statistiques avancées - non accordée" />
          </Card>

          <Callout tone="neutral" icon="shield">
            Le token est conservé côté serveur. Il n’est jamais transmis à l’application ni stocké sur
            le téléphone.
          </Callout>

          <Button label="Continuer" onPress={goToAccounts} block style={styles.action} />
        </View>
      </Screen>
    );
  }

  if (status === 'cancelled') {
    return (
      <Screen centred>
        <View style={styles.content}>
          <View style={[styles.icon, styles.iconNeutral]}>
            <Icon name="close" size={28} color={palette.inkMuted} />
          </View>

          <Text variant="title1" weight="extrabold" center>
            Connexion annulée
          </Text>
          <Text variant="footnote" color={palette.inkFaint} center style={styles.message}>
            Vous avez interrompu la connexion à {networkLabel}. Aucun accès n’a été accordé.
          </Text>

          <View style={styles.actions}>
            <Button
              label="Réessayer"
              onPress={goToAccounts}
              block
            />
            <Button label="Retour" variant="secondary" onPress={goToAccounts} block />
          </View>
        </View>
      </Screen>
    );
  }

  const copy = ERROR_COPY[params.reason ?? 'provider_error'] ?? ERROR_COPY.provider_error!;

  return (
    <Screen centred>
      <View style={styles.content}>
        <View style={[styles.icon, styles.iconError]}>
          <Icon name="priority" size={28} color={palette.dangerText} />
        </View>

        <Text variant="title1" weight="extrabold" center>
          {copy.title}
        </Text>
        <Text variant="footnote" color={palette.inkMuted} center style={styles.message}>
          {copy.message}
        </Text>

        <View style={styles.actions}>
          <Button label="Réessayer" onPress={goToAccounts} block />
          <Button label="Retour aux comptes" variant="secondary" onPress={goToAccounts} block />
        </View>
      </View>
    </Screen>
  );
}

function Permission({ granted, label }: { granted: boolean; label: string }) {
  return (
    <View style={styles.permissionRow}>
      <Icon
        name={granted ? 'check' : 'close'}
        size={15}
        color={granted ? palette.successText : palette.dangerText}
      />
      <Text variant="footnote" color={granted ? palette.inkBody : palette.dangerText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing['3xl'], alignItems: 'stretch' },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSuccess: { backgroundColor: palette.lime },
  iconNeutral: { backgroundColor: palette.surfaceChip },
  iconError: { backgroundColor: palette.dangerBg },
  message: { maxWidth: 340, alignSelf: 'center' },
  permissionsCard: { gap: spacing.lg, borderRadius: radius.lg },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  actions: { gap: spacing.lg },
  action: { marginTop: spacing.md },
});
