import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { palette, radius, spacing, themed } from '@/theme';
import type {
  AccountStatus,
  Intent,
  Priority,
  PublicationStatus,
  Sentiment,
  SocialNetwork,
  TargetStatus,
} from '@/types';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'danger' | 'warning' | 'success' | 'info' | 'accent';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
};

/** Pill label. One component behind every status / sentiment / priority chip. */
export function Badge({ label, tone = 'neutral', icon, style }: BadgeProps) {
  const { background, foreground } = toneColors[tone];

  return (
    <View style={[styles.badge, { backgroundColor: background }, style]}>
      {icon ? <Icon name={icon} size={11} color={foreground} /> : null}
      <Text variant="micro" weight="bold" color={foreground} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const toneColors: Record<BadgeTone, { background: string; foreground: string }> = themed(() => ({
  neutral: { background: palette.surfaceChip, foreground: palette.inkMuted },
  danger: { background: palette.dangerBg, foreground: palette.dangerText },
  warning: { background: palette.warningBg, foreground: palette.warningText },
  success: { background: palette.successBg, foreground: palette.successText },
  info: { background: palette.infoBg, foreground: palette.infoText },
  accent: { background: palette.lime, foreground: palette.onLime },
}));

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
});

// ---------------------------------------------------------------------------
// Domain mappings - a single place that decides how a value is worded and toned.
// ---------------------------------------------------------------------------

export const publicationStatusMeta: Record<PublicationStatus, { label: string; tone: BadgeTone; color: string }> = themed(() => ({
  draft: { label: 'Brouillon', tone: 'neutral', color: palette.inkDisabled },
  pending_approval: { label: 'En attente d’approbation', tone: 'warning', color: palette.warning },
  approved: { label: 'Approuvée', tone: 'success', color: palette.lime },
  rejected: { label: 'À corriger', tone: 'danger', color: palette.danger },
  scheduled: { label: 'Planifiée', tone: 'info', color: palette.info },
  publishing: { label: 'En cours d’envoi', tone: 'warning', color: palette.warning },
  published: { label: 'Publiée', tone: 'success', color: palette.lime },
  partially_published: { label: 'Partiellement publiée', tone: 'danger', color: palette.danger },
  failed: { label: 'Échouée', tone: 'danger', color: palette.danger },
  cancelled: { label: 'Annulée', tone: 'neutral', color: palette.inkDisabled },
}));

export const priorityMeta: Record<Priority, { label: string; tone: BadgeTone; color: string }> = themed(() => ({
  low: { label: 'Faible', tone: 'neutral', color: palette.lime },
  medium: { label: 'Moyenne', tone: 'warning', color: palette.warning },
  high: { label: 'Élevée', tone: 'danger', color: palette.danger },
}));

export const sentimentMeta: Record<Sentiment, { label: string; tone: BadgeTone }> = {
  positive: { label: 'Positif', tone: 'success' },
  neutral: { label: 'Neutre', tone: 'neutral' },
  negative: { label: 'Négatif', tone: 'danger' },
};

export const intentMeta: Record<Intent, { label: string }> = {
  question: { label: 'Question' },
  complaint: { label: 'Plainte' },
  info_request: { label: 'Demande d’information' },
  claim: { label: 'Réclamation' },
  other: { label: 'Autre' },
};

export const accountStatusMeta: Record<AccountStatus, { label: string; tone: BadgeTone }> = {
  connected: { label: 'Connecté', tone: 'success' },
  expiring: { label: 'Expire bientôt', tone: 'warning' },
  expired: { label: 'Expiré', tone: 'warning' },
  reauth_required: { label: 'Reconnexion requise', tone: 'warning' },
  revoked: { label: 'Accès révoqué', tone: 'danger' },
  disconnected: { label: 'Déconnecté', tone: 'neutral' },
};

export const targetStatusMeta: Record<TargetStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'En attente', tone: 'neutral' },
  sent: { label: 'OK', tone: 'success' },
  failed: { label: 'Échec', tone: 'danger' },
};

export const networkMeta: Record<SocialNetwork, { label: string; background: string; foreground: string }> = themed(() => ({
  facebook: { label: 'Facebook', background: palette.facebookBg, foreground: palette.facebookFg },
  instagram: { label: 'Instagram', background: palette.instagramBg, foreground: palette.instagramFg },
}));

/** Square network avatar - `f` for Facebook, a camera ring for Instagram. */
export function NetworkBadge({ network, size = 42 }: { network: SocialNetwork; size?: number }) {
  const meta = networkMeta[network];

  return (
    <View
      accessibilityLabel={meta.label}
      style={[
        networkStyles.tile,
        { width: size, height: size, borderRadius: size / 3, backgroundColor: meta.background },
      ]}
    >
      <Icon name={network === 'facebook' ? 'user' : 'camera'} size={size / 2.4} color={meta.foreground} />
    </View>
  );
}

const networkStyles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
