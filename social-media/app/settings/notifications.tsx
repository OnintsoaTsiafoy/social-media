import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Card,
  Divider,
  ErrorState,
  Screen,
  SelectField,
  SkeletonList,
  Text,
  Toggle,
  useFeedback,
} from '@/components/ui';
import { notificationsApi } from '@/data/api';
import { PRIORITY_OPTIONS, QUIET_HOURS_OPTIONS } from '@/data/options';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { spacing } from '@/theme';
import type { NotificationPreferences, Priority } from '@/types';

/**
 * ÉCRAN 27 - Paramètres de notifications (`/settings/notifications`)
 */
export default function NotificationSettingsScreen() {
  const { confirm, toast } = useFeedback();
  const mutation = useMutation();

  const request = useAsync(() => notificationsApi.getPreferences(), []);
  const [draft, setDraft] = useState<NotificationPreferences | undefined>(undefined);

  useEffect(() => {
    if (request.data) setDraft(request.data);
  }, [request.data]);

  const prefs = draft ?? request.data;
  const dirty = Boolean(draft && request.data && JSON.stringify(draft) !== JSON.stringify(request.data));

  const patch = (changes: Partial<NotificationPreferences>) =>
    setDraft((current) => (current ? { ...current, ...changes } : current));

  const save = async () => {
    if (!draft) return;
    const result = await mutation.run(() => notificationsApi.updatePreferences(draft));
    if (!result.ok) return;
    request.setData(result.data);
    setDraft(result.data);
    toast('Préférences enregistrées.', 'success');
  };

  const resetDefaults = async () => {
    const confirmed = await confirm({
      title: 'Restaurer les valeurs par défaut ?',
      message: 'Toutes vos préférences de notifications seront réinitialisées.',
      confirmLabel: 'Restaurer',
    });
    if (!confirmed) return;

    const result = await mutation.run(() => notificationsApi.resetPreferences());
    if (!result.ok) return;
    request.setData(result.data);
    setDraft(result.data);
    toast('Valeurs par défaut restaurées.', 'success');
  };

  const quietHoursValue =
    prefs?.quietHoursStart && prefs.quietHoursEnd
      ? `${prefs.quietHoursStart}-${prefs.quietHoursEnd}`
      : 'off';

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Notifications"
          showBack
          actionLabel="Défaut"
          onActionPress={resetDefaults}
        />
      }
      footer={
        prefs ? (
          <Button
            label="Enregistrer"
            onPress={save}
            loading={mutation.pending}
            disabled={!dirty}
            block
          />
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : prefs ? (
        <>
          <Group label="Commentaires">
            <Toggle
              label="Commentaire négatif"
              value={prefs.negativeComment}
              onValueChange={(value) => patch({ negativeComment: value })}
            />
            <Divider />
            <Toggle
              label="Commentaire urgent"
              value={prefs.urgentComment}
              onValueChange={(value) => patch({ urgentComment: value })}
            />
            <Divider />
            <Toggle
              label="Priorité élevée"
              value={prefs.highPriorityComment}
              onValueChange={(value) => patch({ highPriorityComment: value })}
            />
            <Divider />
            <Toggle
              label="Réponse IA générée"
              value={prefs.aiResponseGenerated}
              onValueChange={(value) => patch({ aiResponseGenerated: value })}
            />
          </Group>

          <Group label="Publications & comptes">
            <Toggle
              label="Approbations des publications"
              description="Demandes, validations, refus et modifications demandées."
              value={prefs.publicationApproval}
              onValueChange={(value) => patch({ publicationApproval: value })}
            />
            <Divider />
            <Toggle
              label="Publication réussie"
              value={prefs.publicationPublished}
              onValueChange={(value) => patch({ publicationPublished: value })}
            />
            <Divider />
            <Toggle
              label="Publication échouée"
              value={prefs.publicationFailed}
              onValueChange={(value) => patch({ publicationFailed: value })}
            />
            <Divider />
            <Toggle
              label="Token expirant / expiré"
              value={prefs.tokenExpiring}
              onValueChange={(value) => patch({ tokenExpiring: value })}
            />
            <Divider />
            <Toggle
              label="Synchronisation échouée"
              value={prefs.syncFailed}
              onValueChange={(value) => patch({ syncFailed: value })}
            />
          </Group>

          <Group label="Préférences">
            <Toggle label="Son" value={prefs.sound} onValueChange={(value) => patch({ sound: value })} />
            <Divider />
            <Toggle
              label="Vibration"
              value={prefs.vibration}
              onValueChange={(value) => patch({ vibration: value })}
            />
            <Divider />
            <SelectField
              label="Plage silencieuse"
              value={quietHoursValue}
              options={QUIET_HOURS_OPTIONS}
              onChange={(value) => {
                if (value === 'off') {
                  patch({ quietHoursStart: '', quietHoursEnd: '' });
                  return;
                }
                const [start, end] = value.split('-');
                patch({ quietHoursStart: start ?? '', quietHoursEnd: end ?? '' });
              }}
            />
            <Divider />
            <SelectField
              label="Priorité minimale"
              value={prefs.minimumPriority}
              options={PRIORITY_OPTIONS as { value: Priority; label: string }[]}
              onChange={(value) => patch({ minimumPriority: value })}
              hint="Les alertes de priorité inférieure ne déclenchent pas de notification."
            />
          </Group>

          <Button
            label="Tester une notification"
            variant="secondary"
            icon="notification"
            onPress={() => toast('Ceci est une notification de test.', 'info')}
            block
          />

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

          <Callout tone="neutral" icon="info">
            Les notifications push nécessitent une autorisation du système. Les alertes dans
            l’application restent toujours disponibles.
          </Callout>
        </>
      ) : null}
    </Screen>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="eyebrow">{label}</Text>
      <Card style={styles.card}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xl },
  card: { gap: spacing.xl },
});
