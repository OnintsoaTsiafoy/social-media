import { StyleSheet, View } from 'react-native';

import { Avatar, Badge, Button, Card, NetworkBadge, Text, type BadgeTone } from '@/components/ui';
import { formatCompactNumber, formatRelative } from '@/lib/format';
import { palette, spacing } from '@/theme';
import type { Competitor, CompetitorStatus } from '@/types/competitors';

/**
 * Statuts concurrents, rendus lisibles.
 *
 * Trois états sur quatre ne sont pas des pannes : ils décrivent ce que Meta
 * autorise. Le ton et le texte le disent, pour qu'un community manager sache
 * s'il doit attendre, agir, ou ne rien faire.
 */
export const competitorStatusMeta: Record<CompetitorStatus, { label: string; tone: BadgeTone; hint: string }> = {
  active: { label: 'Suivi', tone: 'success', hint: 'Les données publiques accessibles sont collectées.' },
  unavailable: {
    label: 'Inaccessible',
    tone: 'danger',
    hint: 'Ce compte n’est plus lisible via l’API Meta (compte privé, personnel ou supprimé). Les dernières données connues restent affichées.',
  },
  permission_required: {
    label: 'Autorisation requise',
    tone: 'warning',
    hint: 'L’application Meta n’a pas encore l’autorisation nécessaire pour lire ce compte. Les dernières données connues restent affichées.',
  },
  sync_error: {
    label: 'Synchronisation en erreur',
    tone: 'warning',
    hint: 'La dernière tentative a échoué. La prochaine synchronisation réessaiera automatiquement.',
  },
};

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function CompetitorRow({
  competitor,
  onOpen,
  onSync,
  onRemove,
  syncing = false,
  removing = false,
  canManage = true,
}: {
  competitor: Competitor;
  onOpen: () => void;
  onSync?: () => void;
  onRemove?: () => void;
  syncing?: boolean;
  removing?: boolean;
  canManage?: boolean;
}) {
  const status = competitorStatusMeta[competitor.status];
  const followers = competitor.latestMetric?.followersCount ?? null;

  return (
    <Card>
      <View style={styles.body}>
        <View style={styles.header}>
          {competitor.avatarUrl ? (
            <Avatar uri={competitor.avatarUrl} initials={initialsOf(competitor.name)} size={44} />
          ) : (
            <NetworkBadge network={competitor.platform} size={44} />
          )}
          <View style={styles.identity}>
            <Text weight="bold" numberOfLines={1}>
              {competitor.name}
            </Text>
            <Text variant="footnote" color={palette.inkFaint} numberOfLines={1}>
              @{competitor.username}
            </Text>
          </View>
          <Badge label={status.label} tone={status.tone} />
        </View>

        <View style={styles.metaRow}>
          <Badge label={competitor.platform === 'facebook' ? 'Facebook' : 'Instagram'} tone="info" />
          {/* Jamais « 0 abonné » quand Meta ne rend pas le chiffre. */}
          <Text variant="footnote" color={palette.inkFaint}>
            {followers === null ? 'Abonnés : non disponible' : `${formatCompactNumber(followers)} abonnés`}
          </Text>
        </View>

        <Text variant="footnote" color={palette.inkFaint}>
          {competitor.lastSyncedAt
            ? `Dernière synchronisation ${formatRelative(competitor.lastSyncedAt)}`
            : 'Jamais synchronisé'}
        </Text>

        {competitor.status !== 'active' ? (
          <Text variant="footnote" color={palette.inkFaint}>
            {status.hint}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button label="Ouvrir" variant="secondary" size="sm" onPress={onOpen} />
          {canManage && onSync ? (
            <Button label="Synchroniser" variant="secondary" size="sm" loading={syncing} onPress={onSync} />
          ) : null}
          {canManage && onRemove ? (
            <Button label="Supprimer" variant="ghost" size="sm" loading={removing} onPress={onRemove} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
});
