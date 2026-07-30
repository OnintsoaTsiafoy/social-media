import { StyleSheet, View } from 'react-native';

import {
  accountStatusMeta,
  Badge,
  Button,
  Card,
  DetailRow,
  Divider,
  NetworkBadge,
  Text,
} from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { SocialAccount } from '@/types';

export type SocialAccountCardProps = {
  account: SocialAccount;
  onSync?: () => void;
  onReconnect?: () => void;
  onDisconnect?: () => void;
  onViewPermissions?: () => void;
  busyAction?: 'sync' | 'reconnect' | 'disconnect';
};

/**
 * Account card. Tokens are never displayed - only their expiry date, which is
 * what the CM actually needs to act on.
 */
export function SocialAccountCard({
  account,
  onSync,
  onReconnect,
  onDisconnect,
  onViewPermissions,
  busyAction,
}: SocialAccountCardProps) {
  const status = accountStatusMeta[account.status];
  const needsReconnect =
    account.status === 'expired' ||
    account.status === 'reconnect_required' ||
    account.status === 'revoked';
  const missingPermissions = account.permissions.filter((permission) => !permission.granted);

  return (
    <Card tone={needsReconnect ? 'warning' : 'default'} style={styles.card}>
      <View style={styles.header}>
        <NetworkBadge network={account.network} size={44} />
        <View style={styles.headerText}>
          <Text variant="bodyLg" weight="bold" numberOfLines={1}>
            {account.name}
          </Text>
          <Text variant="micro" color={palette.inkFaint} numberOfLines={1} style={styles.meta}>
            {account.username} · {account.kind}
          </Text>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </View>

      {needsReconnect ? (
        <>
          <Text variant="footnote" color={palette.warningText}>
            Le token a expiré. Reconnectez le compte pour reprendre la publication et la synchronisation des
            commentaires.
          </Text>
          <Button
            label={`Reconnecter ${account.network === 'facebook' ? 'Facebook' : 'Instagram'}`}
            variant="primary"
            size="sm"
            onPress={onReconnect}
            loading={busyAction === 'reconnect'}
          />
        </>
      ) : (
        <>
          <Divider />
          <View style={styles.details}>
            <DetailRow label="Marque associée" value={account.brandName} />
            <DetailRow
              label="Expiration du token"
              value={account.tokenExpiresAt ? formatDate(account.tokenExpiresAt) : '-'}
            />
            <DetailRow
              label="Dernière synchro"
              value={account.lastSyncAt ? formatRelative(account.lastSyncAt) : 'Jamais'}
            />
            {missingPermissions.length > 0 ? (
              <DetailRow
                label="Permissions"
                value={`${missingPermissions.length} manquante${missingPermissions.length > 1 ? 's' : ''}`}
                valueColor={palette.warningText}
              />
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button
              label="Synchroniser"
              variant="secondary"
              size="sm"
              onPress={onSync}
              loading={busyAction === 'sync'}
              style={styles.action}
            />
            <Button
              label="Déconnecter"
              variant="danger"
              size="sm"
              onPress={onDisconnect}
              loading={busyAction === 'disconnect'}
              style={styles.action}
            />
          </View>

          {onViewPermissions ? (
            <Text
              variant="micro"
              weight="bold"
              color={palette.inkMuted}
              accessibilityRole="button"
              onPress={onViewPermissions}
            >
              Voir les permissions
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  headerText: { flex: 1 },
  meta: { marginTop: 2 },
  details: { gap: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.lg },
  action: { flex: 1 },
});
