import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SocialAccountCard } from '@/components/domain/SocialAccountCard';
import {
  AppHeader,
  BottomSheet,
  Button,
  Callout,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Screen,
  SkeletonList,
  Text,
  networkMeta,
  useFeedback,
} from '@/components/ui';
import { accountsApi } from '@/data/api';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { SocialAccount, SocialNetwork } from '@/types';

/**
 * ÉCRAN 15 - Gestion des comptes sociaux (`/settings/social-accounts`)
 *
 * Tokens are never rendered or stored on the device; disconnecting revokes
 * access server-side, which the screen explains before asking to confirm.
 */
export default function SocialAccountsScreen() {
  const router = useRouter();
  const { confirm, toast } = useFeedback();

  const request = useAsync(() => accountsApi.list(), []);
  const [busy, setBusy] = useState<{ id: string; action: 'sync' | 'reconnect' | 'disconnect' } | undefined>();
  const [connecting, setConnecting] = useState<SocialNetwork | undefined>(undefined);
  const [permissionsFor, setPermissionsFor] = useState<SocialAccount | undefined>(undefined);

  const accounts = request.data ?? [];

  const sync = async (account: SocialAccount) => {
    setBusy({ id: account.id, action: 'sync' });
    try {
      const updated = await accountsApi.sync(account.id);
      request.setData((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast('Synchronisation terminée.', 'success');
    } catch {
      toast('Le token a expiré. Reconnectez le compte pour continuer.', 'error');
    } finally {
      setBusy(undefined);
    }
  };

  const reconnect = async (account: SocialAccount) => {
    setBusy({ id: account.id, action: 'reconnect' });
    try {
      // A real implementation opens the provider's OAuth flow in a web browser
      // session and returns through the `/oauth/callback` deep link.
      const updated = await accountsApi.reconnect(account.id);
      request.setData((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      router.push({
        pathname: '/oauth/callback',
        params: { status: 'success', network: account.network, account: account.username },
      });
    } catch {
      toast('La reconnexion a échoué. Réessayez.', 'error');
    } finally {
      setBusy(undefined);
    }
  };

  const disconnect = async (account: SocialAccount) => {
    const confirmed = await confirm({
      title: `Déconnecter ${account.username} ?`,
      message:
        'Les publications planifiées sur ce compte ne seront pas envoyées et la synchronisation des commentaires s’arrêtera. L’accès sera révoqué côté serveur.',
      confirmLabel: 'Déconnecter',
      destructive: true,
    });
    if (!confirmed) return;

    setBusy({ id: account.id, action: 'disconnect' });
    try {
      await accountsApi.disconnect(account.id);
      request.setData((current) => current.filter((item) => item.id !== account.id));
      toast('Compte déconnecté.', 'success');
    } catch {
      toast('La déconnexion a échoué. Réessayez.', 'error');
    } finally {
      setBusy(undefined);
    }
  };

  const connect = async (network: SocialNetwork) => {
    setConnecting(network);
    try {
      const created = await accountsApi.connect(network);
      request.setData((current) => [...current, created]);
      router.push({
        pathname: '/oauth/callback',
        params: { status: 'success', network, account: created.username },
      });
    } catch {
      router.push({ pathname: '/oauth/callback', params: { status: 'error', network } });
    } finally {
      setConnecting(undefined);
    }
  };

  return (
    <Screen
      scroll
      refreshing={request.refreshing}
      onRefresh={request.refresh}
      header={
        <AppHeader
          title="Comptes sociaux"
          showBack
          actions={
            <IconButton
              name="sync"
              accessibilityLabel="Actualiser la liste"
              loading={request.refreshing}
              onPress={request.refresh}
            />
          }
        />
      }
    >
      {request.loading ? (
        <SkeletonList count={2} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : (
        <>
          {accounts.length === 0 ? (
            <EmptyState
              icon="link"
              title="Aucun compte connecté"
              message="Connectez une page Facebook ou un compte Instagram professionnel pour publier et synchroniser les commentaires."
            />
          ) : (
            accounts.map((account) => (
              <SocialAccountCard
                key={account.id}
                account={account}
                busyAction={busy?.id === account.id ? busy.action : undefined}
                onSync={() => sync(account)}
                onReconnect={() => reconnect(account)}
                onDisconnect={() => disconnect(account)}
                onViewPermissions={() => setPermissionsFor(account)}
              />
            ))
          )}

          <Card tone="dashed" style={styles.addCard}>
            <Text variant="bodyLg" weight="bold" center>
              Ajouter un compte
            </Text>
            <Text variant="footnote" color={palette.inkFaint} center>
              Connectez une page Facebook ou un compte Instagram professionnel.
            </Text>
            <View style={styles.addActions}>
              <Button
                label="Facebook"
                variant="secondary"
                size="sm"
                onPress={() => connect('facebook')}
                loading={connecting === 'facebook'}
                style={styles.addButton}
              />
              <Button
                label="Instagram"
                variant="secondary"
                size="sm"
                onPress={() => connect('instagram')}
                loading={connecting === 'instagram'}
                style={styles.addButton}
              />
            </View>
          </Card>

          <Callout tone="neutral" icon="shield">
            Les tokens ne sont jamais affichés ni stockés sur le téléphone. La déconnexion révoque
            l’accès côté serveur.
          </Callout>
        </>
      )}

      <BottomSheet
        visible={permissionsFor !== undefined}
        onClose={() => setPermissionsFor(undefined)}
        title={permissionsFor ? `Permissions · ${permissionsFor.username}` : 'Permissions'}
        footer={<Button label="Fermer" variant="secondary" onPress={() => setPermissionsFor(undefined)} block />}
      >
        {permissionsFor ? (
          <Card padded={false}>
            {permissionsFor.permissions.map((permission, index) => (
              <View key={permission.label}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.permissionRow}>
                  <Icon
                    name={permission.granted ? 'checkCircle' : 'cross'}
                    size={17}
                    color={permission.granted ? palette.successText : palette.dangerText}
                  />
                  <Text variant="body" weight="medium" style={styles.permissionLabel}>
                    {permission.label}
                  </Text>
                  <Text
                    variant="micro"
                    weight="bold"
                    color={permission.granted ? palette.successText : palette.dangerText}
                  >
                    {permission.granted ? 'Accordée' : 'Non accordée'}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {permissionsFor ? (
          <Text variant="micro" color={palette.inkFaint} style={styles.permissionFooter}>
            {networkMeta[permissionsFor.network].label} · connecté le{' '}
            {formatDate(permissionsFor.connectedAt)}
            {permissionsFor.tokenExpiresAt
              ? ` · expire le ${formatDate(permissionsFor.tokenExpiresAt)}`
              : ''}
          </Text>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  addCard: { gap: spacing.md, alignItems: 'stretch' },
  addActions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  addButton: { flex: 1 },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing['2xl'],
  },
  permissionLabel: { flex: 1 },
  permissionFooter: { marginTop: spacing.xl },
});
