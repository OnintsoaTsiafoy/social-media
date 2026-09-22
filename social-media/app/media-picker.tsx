import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  BottomSheet,
  Button,
  Callout,
  Card,
  DetailRow,
  Divider,
  Icon,
  MediaPreview,
  ProgressBar,
  Text,
  type IconName,
} from '@/components/ui';
import { mediaApi, toUserMessage } from '@/data/api';
import { formatFileSize, formatMimeType } from '@/lib/format';
import { MEDIA_CONSTRAINTS, validateMedia } from '@/lib/validation';
import { useComposer } from '@/store/ComposerProvider';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing, themed } from '@/theme';
import type { MediaAsset } from '@/types';

type Source = { key: 'gallery' | 'camera' | 'files'; label: string; icon: IconName };

const SOURCES: Source[] = [
  { key: 'gallery', label: 'Galerie', icon: 'image' },
  { key: 'camera', label: 'Photo', icon: 'camera' },
  { key: 'files', label: 'Fichiers', icon: 'files' },
];

/**
 * ÉCRAN 10 - Sélection et prévisualisation d’un média (modal plein écran)
 *
 * Validates format, weight and dimensions *before* the upload, and only binds
 * the asset to the draft once the upload has completed.
 */
export default function MediaPickerScreen() {
  const router = useRouter();
  const { patch } = useComposer();
  const { brand } = useSession();

  const [candidate, setCandidate] = useState<MediaAsset | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const close = () => router.back();

  const pick = async (source: Source['key']) => {
    setError(undefined);
    setPermissionBlocked(false);

    if (source === 'files') {
      setError('La sélection depuis les fichiers arrive dans une prochaine version.');
      return;
    }

    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        // `canAskAgain === false` means only the OS settings can restore access.
        setPermissionBlocked(!permission.canAskAgain);
        setError(
          permission.canAskAgain
            ? 'Autorisation refusée. Autorisez l’accès pour choisir un média.'
            : 'Autorisation refusée définitivement. Ouvrez les paramètres du téléphone pour l’activer.'
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.9, mediaTypes: ['images'] })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.9, mediaTypes: ['images'] });

      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const next: MediaAsset = {
        id: `med_${Date.now()}`,
        fileName: asset.fileName ?? 'image.jpg',
        mimeType: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize ?? 0,
        width: asset.width,
        height: asset.height,
        uri: asset.uri,
        uploadProgress: 0,
      };

      const validationError = validateMedia(next);
      if (validationError) {
        setError(validationError);
        setCandidate(undefined);
        return;
      }

      setCandidate(next);
      setProgress(0);
    } catch {
      setError('Impossible d’ouvrir la source sélectionnée. Réessayez.');
    }
  };

  /** Envoi multipart réel vers `POST /api/v1/media`. */
  const upload = async () => {
    if (!candidate?.uri) return;
    if (!brand?.id) {
      setError('Aucune marque active. Ouvrez « Marque & ton IA » avant d’ajouter un média.');
      return;
    }

    setUploading(true);
    setError(undefined);
    setProgress(0);

    try {
      const stored = await mediaApi.upload(
        { uri: candidate.uri, fileName: candidate.fileName, mimeType: candidate.mimeType },
        brand.id,
        setProgress
      );
      // Le média n’est rattaché au brouillon qu’une fois déposé côté serveur.
      // L’aperçu garde l’URI locale : elle ne dépend pas d’une URL signée.
      patch({ media: { ...stored, uri: candidate.uri } });
      close();
    } catch (caught) {
      setProgress(0);
      setError(toUserMessage(caught));
    } finally {
      setUploading(false);
    }
  };

  return (
    <BottomSheet
      visible
      onClose={close}
      title="Ajouter un média"
      footer={
        <View style={styles.footerRow}>
          <Button label="Annuler" variant="secondary" onPress={close} style={styles.footerButton} />
          <Button
            label={progress > 0 && progress < 1 ? 'Relancer l’envoi' : 'Confirmer'}
            onPress={upload}
            loading={uploading}
            disabled={!candidate}
            style={styles.footerButton}
          />
        </View>
      }
    >
      <View style={styles.sources}>
        {SOURCES.map((source) => (
          <Pressable
            key={source.key}
            accessibilityRole="button"
            accessibilityLabel={source.label}
            onPress={() => pick(source.key)}
            style={({ pressed }) => [styles.source, pressed && styles.sourcePressed]}
          >
            <Icon name={source.icon} size={20} color={palette.ink} />
            <Text variant="body" weight="bold">
              {source.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {candidate ? (
        <Card style={styles.previewCard}>
          <MediaPreview uri={candidate.uri} height={150} />
          <Divider />
          <DetailRow label="Nom" value={candidate.fileName} />
          <DetailRow
            label="Format · Taille"
            value={`${formatMimeType(candidate.mimeType)} · ${formatFileSize(candidate.size)}`}
          />
          <DetailRow label="Dimensions" value={`${candidate.width} × ${candidate.height}`} />
          {uploading || progress > 0 ? <ProgressBar progress={progress} label="Envoi" /> : null}
        </Card>
      ) : (
        <Card tone="muted" style={styles.constraints}>
          <Text variant="footnote" color={palette.inkMuted}>
            Formats acceptés : JPEG, PNG, WebP. Taille maximale{' '}
            {formatFileSize(MEDIA_CONSTRAINTS.maxBytes)}. Dimensions minimales{' '}
            {MEDIA_CONSTRAINTS.minDimension} × {MEDIA_CONSTRAINTS.minDimension} px.
          </Text>
          <Text variant="micro" color={palette.inkFaint}>
            Périmètre actuel : une image par publication.
          </Text>
        </Card>
      )}

      {error ? (
        <Callout tone="danger" icon="priority">
          <Text variant="footnote" color={palette.dangerText}>
            {error}
          </Text>
          {permissionBlocked ? (
            <Text
              variant="body"
              weight="bold"
              color={palette.dangerText}
              accessibilityRole="button"
              onPress={() => {
                if (Platform.OS !== 'web') void Linking.openSettings();
              }}
              style={styles.settingsLink}
            >
              Ouvrir les paramètres
            </Text>
          ) : null}
        </Callout>
      ) : null}
    </BottomSheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    sources: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing['3xl'] },
    source: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 16,
      padding: spacing['2xl'],
      gap: spacing.md,
    },
    sourcePressed: { opacity: 0.7, backgroundColor: palette.surfaceMuted },
    previewCard: { gap: spacing.xl },
    constraints: { gap: spacing.md },
    settingsLink: { marginTop: spacing.lg },
    footerRow: { flexDirection: 'row', gap: spacing.lg },
    footerButton: { flex: 1 },
  })
);
