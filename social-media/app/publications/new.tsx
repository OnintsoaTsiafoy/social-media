import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ComposerForm, type ComposerErrors } from '@/components/domain/ComposerForm';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Screen,
  SkeletonList,
  useFeedback,
} from '@/components/ui';
import { accountsApi, publicationsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { messages } from '@/lib/validation';
import { useComposer } from '@/store/ComposerProvider';
import { useSession } from '@/store/SessionProvider';
import { spacing } from '@/theme';

/**
 * ÉCRAN 08 - Création d’une publication (`/publications/new`)
 *
 * Three exits: save as draft, publish now, or schedule. Leaving with unsaved
 * changes always asks first.
 */
export default function NewPublicationScreen() {
  const router = useRouter();
  const { brand } = useSession();
  const { confirm, toast } = useFeedback();
  const { draft, dirty, reset } = useComposer();
  const mutation = useMutation();

  const accounts = useAsync(() => accountsApi.list(), []);
  const [errors, setErrors] = useState<ComposerErrors>({});

  // Start from a clean draft bound to the active brand.
  useEffect(() => {
    reset({ brandId: brand?.id ?? '' });
  }, [brand?.id, reset]);

  const clearError = (key: keyof ComposerErrors) =>
    setErrors((current) => ({ ...current, [key]: undefined }));

  const validate = (mode: 'draft' | 'publish' | 'schedule'): boolean => {
    const next: ComposerErrors = {
      text: draft.text.trim() ? undefined : messages.textRequired,
      networks: mode === 'draft' || draft.networks.length > 0 ? undefined : messages.networkRequired,
      media:
        draft.media && draft.media.uploadProgress < 1
          ? 'Attendez la fin de l’envoi du média.'
          : undefined,
    };
    setErrors(next);
    return !next.text && !next.networks && !next.media;
  };

  const submit = async (mode: 'draft' | 'publish' | 'schedule') => {
    if (!validate(mode)) return;

    if (mode === 'publish') {
      const confirmed = await confirm({
        title: 'Publier maintenant ?',
        message: `La publication sera envoyée immédiatement sur ${draft.networks.length} réseau${
          draft.networks.length > 1 ? 'x' : ''
        }.`,
        confirmLabel: 'Publier',
      });
      if (!confirmed) return;
    }

    const result = await mutation.run(() =>
      publicationsApi.create(
        {
          brandId: draft.brandId || (brand?.id ?? ''),
          text: draft.text,
          language: brand?.primaryLanguage ?? 'fr',
          hashtags: draft.hashtags,
          media: draft.media,
          networks: draft.networks,
          perNetwork: draft.perNetworkEnabled ? draft.perNetwork : undefined,
        },
        mode === 'schedule' ? 'draft' : mode
      )
    );
    if (!result.ok) return;

    reset({ brandId: brand?.id ?? '' });

    if (mode === 'draft') {
      toast('La publication a été enregistrée comme brouillon.', 'success');
      router.replace(`/publications/${result.data.id}`);
      return;
    }
    if (mode === 'publish') {
      toast('La publication a été envoyée.', 'success');
      router.replace(`/publications/${result.data.id}`);
      return;
    }
    // Scheduling continues on the dedicated screen, which owns date validation.
    router.replace(`/publications/${result.data.id}/schedule`);
  };

  const handleBack = async () => {
    if (dirty) {
      const confirmed = await confirm({
        title: 'Abandonner cette publication ?',
        message: 'Les modifications ne sont pas enregistrées.',
        confirmLabel: 'Abandonner',
        destructive: true,
      });
      if (!confirmed) return;
      reset({ brandId: brand?.id ?? '' });
    }
    router.back();
  };

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Nouvelle publication"
          showBack
          onBack={handleBack}
          actions={dirty ? <Badge label="Non enregistré" tone="warning" /> : undefined}
        />
      }
      footer={
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Button
              label="Brouillon"
              variant="secondary"
              size="sm"
              onPress={() => submit('draft')}
              disabled={mutation.pending}
              style={styles.footerButton}
            />
            <Button
              label="Planifier"
              variant="accent"
              size="sm"
              onPress={() => submit('schedule')}
              disabled={mutation.pending}
              style={styles.footerButton}
            />
          </View>
          <Button
            label="Publier maintenant"
            onPress={() => submit('publish')}
            loading={mutation.pending}
            block
          />
        </View>
      }
    >
      {accounts.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : (
        <>
          <ComposerForm
            brand={brand}
            accounts={accounts.data ?? []}
            errors={errors}
            onClearError={clearError}
            onChangeBrand={() => toast('Une seule marque active dans cette version.', 'info')}
          />
          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.lg },
  footerButton: { flex: 1 },
});
