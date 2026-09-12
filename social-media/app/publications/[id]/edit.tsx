import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ComposerForm, type ComposerErrors } from '@/components/domain/ComposerForm';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  DetailRow,
  ErrorState,
  Screen,
  SkeletonList,
  Text,
  publicationStatusMeta,
  useFeedback,
} from '@/components/ui';
import { accountsApi, publicationsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { formatDateTime } from '@/lib/format';
import { messages } from '@/lib/validation';
import { useComposer } from '@/store/ComposerProvider';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';
import type { PublicationStatus } from '@/types';

/** Which statuses may still be edited - mirrors the table in the spec. */
const EDITABLE: Record<PublicationStatus, { allowed: boolean; note: string }> = {
  draft: { allowed: true, note: 'Modifiable' },
  scheduled: { allowed: true, note: 'Modifiable jusqu’à l’exécution' },
  publishing: { allowed: false, note: 'Bloquée pendant l’envoi' },
  published: { allowed: false, note: 'Duplication seulement' },
  partially_published: { allowed: true, note: 'Relance du réseau en erreur' },
  failed: { allowed: true, note: 'Modifiable · relance' },
  cancelled: { allowed: false, note: 'Duplication ou suppression' },
};

/**
 * ÉCRAN 09 - Modification d’une publication (`/publications/:id/edit`)
 *
 * Reuses the composer blocks, adds the status rules, and keeps the previous
 * values if saving fails.
 */
export default function EditPublicationScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { brand } = useSession();
  const { confirm, toast } = useFeedback();
  const { draft, dirty, reset } = useComposer();
  const mutation = useMutation();

  const request = useAsync(() => publicationsApi.get(id), [id]);
  const accounts = useAsync(() => accountsApi.list(brand?.id ?? '', brand?.name ?? ''), []);
  const [errors, setErrors] = useState<ComposerErrors>({});

  const publication = request.data;
  const rules = publication ? EDITABLE[publication.status] : undefined;

  // Load the stored publication into the composer once.
  useEffect(() => {
    if (!publication) return;
    reset({
      brandId: publication.brandId,
      text: publication.text,
      hashtags: publication.hashtags,
      media: publication.media,
      networks: publication.targets.map((target) => target.network),
      perNetworkEnabled: Boolean(publication.perNetwork),
      perNetwork: publication.perNetwork ?? {},
    });
  }, [publication, reset]);

  const clearError = (key: keyof ComposerErrors) =>
    setErrors((current) => ({ ...current, [key]: undefined }));

  const save = async () => {
    if (!publication) return;

    const next: ComposerErrors = {
      text: draft.text.trim() ? undefined : messages.textRequired,
      networks: draft.networks.length > 0 ? undefined : messages.networkRequired,
    };
    setErrors(next);
    if (next.text || next.networks) return;

    if (publication.status === 'scheduled') {
      const confirmed = await confirm({
        title: 'Modifier une publication planifiée ?',
        message: `Elle est planifiée pour le ${formatDateTime(publication.scheduledAt ?? '')}. La planification est conservée.`,
        confirmLabel: 'Enregistrer',
      });
      if (!confirmed) return;
    }

    const result = await mutation.run(() =>
      publicationsApi.update(publication.id, {
        text: draft.text.trim(),
        hashtags: draft.hashtags,
        media: draft.media,
        networks: draft.networks,
        perNetwork: draft.perNetworkEnabled ? draft.perNetwork : undefined,
      })
    );
    // On failure the loaded values stay on screen - nothing is discarded.
    if (!result.ok) return;

    request.setData(result.data);
    toast('Modifications enregistrées.', 'success');
    router.back();
  };

  const cancelSchedule = async () => {
    if (!publication) return;
    const confirmed = await confirm({
      title: 'Annuler la planification ?',
      message: 'La publication repassera en brouillon et ne sera pas envoyée.',
      confirmLabel: 'Annuler la planification',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await mutation.run(() => publicationsApi.cancelSchedule(publication.id));
    if (!result.ok) return;
    toast('Planification annulée.', 'success');
    router.back();
  };

  const remove = async () => {
    if (!publication) return;
    const confirmed = await confirm({
      title: 'Supprimer cette publication ?',
      message: 'Cette action est définitive.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await mutation.run(() => publicationsApi.remove(publication.id));
    if (!result.ok) return;
    toast('Publication supprimée.', 'success');
    router.replace('/publications');
  };

  const handleBack = async () => {
    if (dirty) {
      const confirmed = await confirm({
        title: 'Quitter sans enregistrer ?',
        message: 'Les modifications ne sont pas enregistrées.',
        confirmLabel: 'Quitter',
        destructive: true,
      });
      if (!confirmed) return;
    }
    router.back();
  };

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Modifier la publication"
          showBack
          onBack={handleBack}
          actions={dirty ? <Badge label="Non enregistré" tone="warning" /> : undefined}
        />
      }
      footer={
        publication && rules?.allowed ? (
          <View style={styles.footer}>
            <Button
              label="Enregistrer les modifications"
              onPress={save}
              loading={mutation.pending}
              disabled={!dirty}
              block
            />
            <View style={styles.footerRow}>
              {publication.status === 'scheduled' ? (
                <Button
                  label="Annuler la planification"
                  variant="secondary"
                  size="sm"
                  onPress={cancelSchedule}
                  disabled={mutation.pending}
                  style={styles.footerButton}
                />
              ) : null}
              <Button
                label="Supprimer"
                variant="danger"
                size="sm"
                onPress={remove}
                disabled={mutation.pending}
                style={publication.status === 'scheduled' ? undefined : styles.footerButton}
              />
            </View>
          </View>
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : publication ? (
        <>
          {publication.status === 'scheduled' && publication.scheduledAt ? (
            <Callout tone="info" icon="clock">
              Publication planifiée le {formatDateTime(publication.scheduledAt)} - modifiable jusqu’à
              l’exécution.
            </Callout>
          ) : null}

          {!rules?.allowed ? (
            <Callout tone="warning" icon="lock" title="Modification impossible">
              Cette publication est au statut « {publicationStatusMeta[publication.status].label} ».{' '}
              {rules?.note}.
            </Callout>
          ) : null}

          {rules?.allowed ? (
            <ComposerForm
              brand={brand}
              accounts={accounts.data ?? []}
              errors={errors}
              onClearError={clearError}
            />
          ) : null}

          <View style={styles.rulesSection}>
            <Text variant="eyebrow">Règles par statut</Text>
            <Card style={styles.rulesCard}>
              {(Object.keys(EDITABLE) as PublicationStatus[]).map((status) => (
                <DetailRow
                  key={status}
                  label={publicationStatusMeta[status].label}
                  value={EDITABLE[status].note}
                  valueColor={EDITABLE[status].allowed ? palette.successText : palette.dangerText}
                />
              ))}
            </Card>
          </View>

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.lg },
  footerButton: { flex: 1 },
  rulesSection: { gap: spacing.xl },
  rulesCard: { gap: spacing.xl },
});
