import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  CardPressArea,
  Chip,
  ChipWrap,
  Divider,
  Icon,
  IconButton,
  ProgressBar,
  Text,
  TextField,
  Thumbnail,
  Toggle,
  accountStatusMeta,
  networkMeta,
} from '@/components/ui';
import { formatFileSize, formatMimeType } from '@/lib/format';
import { characterLimitFor } from '@/lib/validation';
import { useComposer } from '@/store/ComposerProvider';
import { palette, spacing, themed } from '@/theme';
import type { Brand, SocialAccount, SocialNetwork } from '@/types';

export type ComposerErrors = { text?: string; networks?: string; media?: string };

export type ComposerFormProps = {
  brand: Brand | undefined;
  accounts: SocialAccount[];
  errors: ComposerErrors;
  onClearError: (key: keyof ComposerErrors) => void;
  /** Lets the brand block open a brand switcher on the create screen only. */
  onChangeBrand?: () => void;
};

/**
 * Blocks 1 → 5 of the publication composer, shared by the create and edit
 * screens so the two stay in sync (the spec requires identical blocks).
 */
export function ComposerForm({
  brand,
  accounts,
  errors,
  onClearError,
  onChangeBrand,
}: ComposerFormProps) {
  const router = useRouter();
  const { draft, patch } = useComposer();

  const limit = characterLimitFor(draft.networks);
  const overLimit = draft.text.length > limit;

  const toggleNetwork = (network: SocialNetwork) => {
    const next = draft.networks.includes(network)
      ? draft.networks.filter((item) => item !== network)
      : [...draft.networks, network];
    patch({ networks: next });
    onClearError('networks');
  };

  return (
    <>
      {/* Block 1 - brand */}
      <Card onPress={onChangeBrand} style={styles.brandCard}>
        <View style={styles.brandText}>
          <Text variant="micro" color={palette.inkFaint}>
            Marque
          </Text>
          <Text variant="bodyLg" weight="bold" numberOfLines={1}>
            {brand?.name ?? '-'}
          </Text>
          <Text variant="micro" color={palette.inkFaint} numberOfLines={1}>
            {brand
              ? `${brand.primaryLanguage.toUpperCase()} · ton ${toneLabel(brand.tone)} · ${accounts.length} compte${accounts.length > 1 ? 's' : ''}`
              : 'Aucune marque'}
          </Text>
        </View>
        {onChangeBrand ? <Icon name="chevronDown" size={17} color={palette.inkDisabled} /> : null}
      </Card>

      {/* Block 2 - content */}
      <View style={styles.section}>
        <TextField
          label="Contenu"
          counter={`${draft.text.length} / ${limit.toLocaleString('fr-FR')}`}
          value={draft.text}
          onChangeText={(value) => {
            patch({ text: value });
            onClearError('text');
          }}
          error={errors.text}
          placeholder="Rédigez votre publication…"
          multiline
        />

        {overLimit ? (
          <Callout tone="warning" icon="priority">
            Le texte dépasse la limite recommandée pour{' '}
            {draft.networks.includes('instagram') ? 'Instagram' : 'ce réseau'} ({limit.toLocaleString('fr-FR')}{' '}
            caractères). Il risque d’être tronqué.
          </Callout>
        ) : null}

        <ChipWrap>
          {draft.hashtags.map((hashtag) => (
            <Chip
              key={hashtag}
              label={hashtag}
              variant="tag"
              onPress={() => patch({ hashtags: draft.hashtags.filter((item) => item !== hashtag) })}
            />
          ))}
          <Chip
            label="Générer des hashtags"
            icon="ai"
            variant="choice"
            selected
            onPress={() => router.push('/hashtags')}
          />
        </ChipWrap>
      </View>

      {/* Block 3 - media */}
      <View style={styles.section}>
        <Text variant="eyebrow">Média</Text>
        {draft.media ? (
          <Card style={styles.mediaCard}>
            <Thumbnail size={52} uri={draft.media.uri} />
            <View style={styles.mediaText}>
              <Text variant="body" weight="semibold" numberOfLines={1}>
                {draft.media.fileName}
              </Text>
              <Text variant="micro" color={palette.inkFaint}>
                {formatMimeType(draft.media.mimeType)} · {draft.media.width}×{draft.media.height} ·{' '}
                {formatFileSize(draft.media.size)}
              </Text>
              {draft.media.uploadProgress < 1 ? (
                <ProgressBar progress={draft.media.uploadProgress} />
              ) : null}
            </View>
            <View style={styles.mediaActions}>
              <IconButton
                name="replace"
                accessibilityLabel="Remplacer le média"
                variant="plain"
                size={32}
                onPress={() => router.push('/media-picker')}
              />
              <IconButton
                name="close"
                accessibilityLabel="Supprimer le média"
                variant="plain"
                size={32}
                onPress={() => patch({ media: null })}
              />
            </View>
          </Card>
        ) : (
          <Card tone="dashed" onPress={() => router.push('/media-picker')} style={styles.addMedia}>
            <Icon name="image" size={20} color={palette.inkMuted} />
            <View>
              <Text variant="body" weight="bold">
                Ajouter une image
              </Text>
              <Text variant="micro" color={palette.inkFaint}>
                JPEG, PNG ou WebP · 8 Mo maximum
              </Text>
            </View>
          </Card>
        )}
        {errors.media ? (
          <Text variant="micro" weight="medium" color={palette.dangerText}>
            {errors.media}
          </Text>
        ) : null}
      </View>

      {/* Block 4 - target networks */}
      <View style={styles.section}>
        <Text variant="eyebrow">Réseaux ciblés</Text>

        {accounts.length === 0 ? (
          <Card tone="warning">
            <Text variant="footnote" color={palette.warningText}>
              Aucun compte social connecté. Connectez une page Facebook ou un compte Instagram
              professionnel pour publier.
            </Text>
            <Button
              label="Connecter un compte"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/settings/social-accounts')}
              style={styles.connectButton}
            />
          </Card>
        ) : (
          <View style={styles.networkList}>
            {accounts.map((account) => {
              const selected = draft.networks.includes(account.network);
              const blocked =
                account.status !== 'connected' && account.status !== 'expiring';
              const status = accountStatusMeta[account.status];

              return (
                <Card
                  key={account.id}
                  tone={blocked ? 'warning' : 'default'}
                  padded={false}
                  style={styles.networkRow}
                >
                  <CardPressArea
                    onPress={() => toggleNetwork(account.network)}
                    accessibilityLabel={`${networkMeta[account.network].label} ${account.username}, ${
                      selected ? 'sélectionné' : 'non sélectionné'
                    }`}
                    style={styles.networkPress}
                  >
                    <View style={[styles.checkbox, selected ? styles.checkboxOn : styles.checkboxOff]}>
                      {selected ? <Icon name="check" size={13} color={palette.onLime} /> : null}
                    </View>
                    <Text variant="body" weight="semibold" numberOfLines={1} style={styles.networkLabel}>
                      {networkMeta[account.network].label} · {account.username}
                    </Text>
                  </CardPressArea>
                  {blocked ? (
                    <Text
                      variant="micro"
                      weight="bold"
                      color={palette.warningText}
                      accessibilityRole="button"
                      onPress={() => router.push('/settings/social-accounts')}
                    >
                      Voir le compte
                    </Text>
                  ) : (
                    <Badge label={status.label} tone={status.tone} />
                  )}
                </Card>
              );
            })}
          </View>
        )}

        {errors.networks ? (
          <Text variant="micro" weight="medium" color={palette.dangerText}>
            {errors.networks}
          </Text>
        ) : null}
      </View>

      {/* Block 5 - per-network adaptation */}
      {draft.networks.length > 1 ? (
        <View style={styles.section}>
          <Text variant="eyebrow">Adaptation par réseau</Text>
          <Card style={styles.adaptCard}>
            <Toggle
              label="Contenu différent par réseau"
              description="Rédigez un texte distinct pour Facebook et Instagram."
              value={draft.perNetworkEnabled}
              onValueChange={(value) => patch({ perNetworkEnabled: value })}
            />

            {draft.perNetworkEnabled ? (
              <>
                <Divider />
                {draft.networks.map((network) => (
                  <TextField
                    key={network}
                    label={`Texte ${networkMeta[network].label}`}
                    value={draft.perNetwork[network]?.text ?? draft.text}
                    onChangeText={(value) =>
                      patch({
                        perNetwork: {
                          ...draft.perNetwork,
                          [network]: {
                            text: value,
                            hashtags: draft.perNetwork[network]?.hashtags ?? draft.hashtags,
                          },
                        },
                      })
                    }
                    multiline
                  />
                ))}
              </>
            ) : null}
          </Card>
        </View>
      ) : null}
    </>
  );
}

function toneLabel(tone: Brand['tone']): string {
  const labels: Record<Brand['tone'], string> = {
    professional: 'professionnel',
    friendly: 'amical',
    empathetic: 'empathique',
    formal: 'formel',
    custom: 'personnalisé',
  };
  return labels[tone];
}

const styles = themed(() =>
  StyleSheet.create({
    section: { gap: spacing.xl },
    brandCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
    brandText: { flex: 1, gap: 2 },

    mediaCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
    mediaText: { flex: 1, gap: spacing.xs },
    mediaActions: { gap: spacing.xl, alignItems: 'center' },
    addMedia: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },

    networkList: { gap: spacing.lg },
    networkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, paddingRight: spacing['2xl'] },
    /** Card padding, minus the trailing edge the row owns. */
    networkPress: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xl,
      padding: spacing['2xl'],
      paddingRight: 0,
    },
    networkLabel: { flex: 1 },
    checkbox: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: palette.lime },
    checkboxOff: { borderWidth: 1.5, borderColor: palette.borderStrong },

    adaptCard: { gap: spacing.xl },
    connectButton: { marginTop: spacing.xl },
  })
);
