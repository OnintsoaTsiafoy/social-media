import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Card,
  Divider,
  ErrorState,
  Icon,
  PasswordField,
  Screen,
  SkeletonList,
  Text,
  useFeedback,
} from '@/components/ui';
import { auth, profile } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { formatRelative } from '@/lib/format';
import { checkPassword, validateConfirmation, validatePassword } from '@/lib/validation';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 28 - Sécurité et changement de mot de passe (`/settings/security`)
 *
 * No token or secret is ever rendered. Revoking all devices signs this one out
 * too, so it asks for confirmation first.
 */
export default function SecurityScreen() {
  const { toast, confirm } = useFeedback();
  const { signOut } = useSession();
  const passwordChange = useMutation();
  const sessionAction = useMutation();

  const sessions = useAsync(() => profile.listSessions(), []);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirmation?: string }>({});

  const checks = checkPassword(next);

  const submit = async () => {
    const validation = {
      current: current ? undefined : 'Saisissez votre mot de passe actuel.',
      next: validatePassword(next) ?? (current === next ? 'Le nouveau mot de passe doit être différent de l’ancien.' : undefined),
      confirmation: validateConfirmation(next, confirmation),
    };
    setErrors(validation);
    if (validation.current || validation.next || validation.confirmation) return;

    const result = await passwordChange.run(() => auth.changePassword(current, next));
    if (!result.ok) return;

    setCurrent('');
    setNext('');
    setConfirmation('');
    toast('Votre mot de passe a été modifié.', 'success');
  };

  const revoke = async (id: string, device: string) => {
    const confirmed = await confirm({
      title: 'Fermer cette session ?',
      message: `${device} devra se reconnecter pour accéder à votre espace.`,
      confirmLabel: 'Fermer la session',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await sessionAction.run(() => profile.revokeSession(id));
    if (!result.ok) return;
    sessions.setData((currentList) => currentList.filter((item) => item.id !== id));
    toast('Session fermée.', 'success');
  };

  const revokeAll = async () => {
    const confirmed = await confirm({
      title: 'Déconnecter tous les appareils ?',
      message: 'Vous serez également déconnecté de cet appareil et devrez vous reconnecter.',
      confirmLabel: 'Déconnecter tout',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await sessionAction.run(() => profile.revokeAllSessions());
    if (!result.ok) return;
    await signOut();
  };

  return (
    <Screen scroll header={<AppHeader title="Sécurité" showBack />}>
      <View style={styles.section}>
        <Text variant="eyebrow">Changer le mot de passe</Text>

        <PasswordField
          placeholder="Mot de passe actuel"
          value={current}
          onChangeText={(value) => {
            setCurrent(value);
            setErrors((state) => ({ ...state, current: undefined }));
          }}
          error={errors.current}
        />

        <PasswordField
          placeholder="Nouveau mot de passe"
          value={next}
          onChangeText={(value) => {
            setNext(value);
            setErrors((state) => ({ ...state, next: undefined }));
          }}
          error={errors.next}
        />

        <PasswordField
          placeholder="Confirmation"
          value={confirmation}
          onChangeText={(value) => {
            setConfirmation(value);
            setErrors((state) => ({ ...state, confirmation: undefined }));
          }}
          error={errors.confirmation}
          onSubmitEditing={submit}
        />

        {next.length > 0 ? (
          <View style={styles.checklist}>
            <Requirement met={checks.length} label="8 caractères minimum" />
            <Requirement met={checks.upperAndLower} label="Une majuscule et une minuscule" />
            <Requirement met={checks.digit} label="Un chiffre" />
            <Requirement met={checks.special} label="Un caractère spécial (recommandé)" optional />
          </View>
        ) : (
          <Text variant="micro" color={palette.inkFaint}>
            Le nouveau mot de passe doit être différent de l’ancien et respecter la politique de
            sécurité.
          </Text>
        )}

        {passwordChange.error ? <Callout tone="danger">{passwordChange.error}</Callout> : null}

        <Button
          label="Modifier le mot de passe"
          onPress={submit}
          loading={passwordChange.pending}
          block
        />
      </View>

      <View style={styles.section}>
        <Text variant="eyebrow">Sessions actives</Text>

        {sessions.loading ? (
          <SkeletonList count={2} withThumbnail={false} />
        ) : sessions.error ? (
          <ErrorState compact message={sessions.error} onRetry={sessions.reload} />
        ) : (
          <Card padded={false}>
            {(sessions.data ?? []).map((session, index) => (
              <View key={session.id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.sessionRow}>
                  <View style={styles.sessionText}>
                    <Text variant="body" weight="bold">
                      {session.device}
                    </Text>
                    <Text variant="micro" color={palette.inkFaint}>
                      {session.location} ·{' '}
                      {session.current ? 'actif maintenant' : `dernière activité ${formatRelative(session.lastActiveAt)}`}
                    </Text>
                  </View>

                  {session.current ? (
                    <Text variant="micro" weight="bold" color={palette.successText}>
                      Actif
                    </Text>
                  ) : (
                    <Text
                      variant="body"
                      weight="bold"
                      color={palette.dangerText}
                      accessibilityRole="button"
                      onPress={() => revoke(session.id, session.device)}
                    >
                      Fermer
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </Card>
        )}

        <Button
          label="Déconnecter tous les appareils"
          variant="danger"
          onPress={revokeAll}
          loading={sessionAction.pending}
          block
        />
      </View>

      <Callout tone="neutral" icon="shield">
        Aucun token n’est affiché. Les données sensibles sont stockées dans le coffre sécurisé du
        téléphone.
      </Callout>
    </Screen>
  );
}

function Requirement({ met, label, optional = false }: { met: boolean; label: string; optional?: boolean }) {
  const color = met ? palette.successText : optional ? palette.inkPlaceholder : palette.inkMuted;

  return (
    <View style={styles.requirement}>
      <Icon name={met ? 'check' : 'close'} size={13} color={color} />
      <Text variant="footnote" color={color}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xl },
  checklist: { gap: spacing.md },
  requirement: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing['2xl'],
  },
  sessionText: { flex: 1 },
});
