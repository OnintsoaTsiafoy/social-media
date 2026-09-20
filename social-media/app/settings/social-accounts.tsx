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
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';
import type { SocialAccount } from '@/types';

/**
 * ÉCRAN 15 - Gestion des comptes sociaux (`/settings/social-accounts`)
 *
 * Tokens are never rendered or stored on the device; disconnecting revokes
 * access server-side, which the screen explains before asking to confirm.
 *
 * Connecting or reconnecting a page is NOT done here: a platform administrator
 * does it from the web console, so this screen only lists, revalidates and
 * disconnects accounts.
 */
export default function SocialAccountsScreen() {
  const { brand } = useSession();
  const { confirm, toast } = useFeedback();

  const request = useAsync(() => accountsApi.list(brand?.id ?? '', brand?.name ?? ''), []);
  const [busy, setBusy] = useState<{ id: string; action: 'sync' | 'disconnect' } | undefined>();
  const [permissionsFor, setPermissionsFor] = useState<SocialAccount | undefined>(undefined);

  const accounts = request.data ?? [];

  const sync = async (account: SocialAccount) => {
    setBusy({ id: account.id, action: 'sync' });
    try {
      const updated = await accountsApi.sync(account.id, brand?.id ?? '', brand?.name ?? '');
      request.setData((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast('Synchronisation terminée.', 'success');
    } catch {
      toast('Le token a expiré. Un administrateur de la plateforme doit reconnecter le compte.', 'error');
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
              message="Un administrateur de la plateforme doit relier une page Facebook à votre marque, depuis la console d’administration, pour publier et synchroniser les commentaires."
            />
          ) : (
            accounts.map((account) => (
              <SocialAccountCard
                key={account.id}
                account={account}
                busyAction={busy?.id === account.id ? busy.action : undefined}
                onSync={() => sync(account)}
                onDisconnect={() => disconnect(account)}
                onViewPermissions={() => setPermissionsFor(account)}
              />
            ))
          )}

          <Callout tone="neutral" icon="link">
            Les comptes sont connectés par un administrateur de la plateforme, depuis la console
            web. Pour ajouter une page ou reconnecter un compte expiré, contactez-le.
          </Callout>

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
