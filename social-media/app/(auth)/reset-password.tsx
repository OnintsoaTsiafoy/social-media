import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Icon,
  PasswordField,
  Screen,
  Text,
  useFeedback,
} from '@/components/ui';
import { auth } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import { checkPassword, passwordStrength, validateConfirmation, validatePassword } from '@/lib/validation';
import { palette, radius, spacing, themed } from '@/theme';

/**
 * ÉCRAN 05 - Réinitialisation du mot de passe (`/reset-password`)
 *
 * Reached from the email deep link, which carries the reset `token`. A missing
 * or expired token is reported up front rather than after a failed submit.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { toast } = useFeedback();
  const mutation = useMutation();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});

  const checks = checkPassword(password);
  const strength = passwordStrength(password);
  const linkMissing = !token;

  const submit = async () => {
    const next = {
      password: validatePassword(password),
      confirmation: validateConfirmation(password, confirmation),
    };
    setErrors(next);
    if (next.password || next.confirmation) return;

    const result = await mutation.run(() => auth.resetPassword(token ?? '', password));
    if (!result.ok) return;

    toast('Votre mot de passe a été modifié.', 'success');
    router.replace('/login');
  };

  return (
    <Screen scroll header={<AppHeader title="Nouveau mot de passe" showBack />}>
      <View>
        <Text variant="display" weight="extrabold">
          Nouveau mot de passe
        </Text>
        <Text variant="footnote" color={palette.inkFaint} style={styles.subtitle}>
          Choisissez un mot de passe respectant les critères de sécurité.
        </Text>
      </View>

      {linkMissing ? (
        <Callout tone="warning" icon="clock" title="Lien invalide">
          Ce lien de réinitialisation est incomplet, expiré ou a déjà été utilisé. Demandez un nouveau
          lien depuis l’écran de connexion.
        </Callout>
      ) : null}

      <View style={styles.form}>
        <PasswordField
          placeholder="Nouveau mot de passe"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrors((current) => ({ ...current, password: undefined }));
          }}
          error={errors.password}
          editable={!linkMissing}
        />

        <PasswordField
          placeholder="Confirmation"
          value={confirmation}
          onChangeText={(value) => {
            setConfirmation(value);
            setErrors((current) => ({ ...current, confirmation: undefined }));
          }}
          error={errors.confirmation}
          editable={!linkMissing}
          onSubmitEditing={submit}
        />

        <View
          accessibilityLabel={`Force du mot de passe : ${strength} sur 4`}
          style={styles.strength}
        >
          {[0, 1, 2, 3].map((index) => (
            <View
              key={index}
              style={[styles.strengthSegment, index < strength && styles.strengthSegmentFilled]}
            />
          ))}
        </View>

        <View style={styles.checklist}>
          <Requirement met={checks.length} label="8 caractères minimum" />
          <Requirement met={checks.upperAndLower} label="Une majuscule et une minuscule" />
          <Requirement met={checks.digit} label="Un chiffre" />
          <Requirement met={checks.special} label="Un caractère spécial (recommandé)" optional />
        </View>

        {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

        <Button
          label="Modifier mon mot de passe"
          onPress={submit}
          loading={mutation.pending}
          disabled={linkMissing}
          block
        />

        <Text
          variant="body"
          weight="semibold"
          color={palette.inkMuted}
          center
          accessibilityRole="link"
          onPress={() => router.replace('/login')}
          style={styles.backLink}
        >
          Retour à la connexion
        </Text>
      </View>
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

const styles = themed(() =>
  StyleSheet.create({
    subtitle: { marginTop: spacing.md, maxWidth: 340 },
    form: { gap: spacing['3xl'] },
    strength: { flexDirection: 'row', gap: spacing.sm },
    strengthSegment: {
      flex: 1,
      height: 5,
      borderRadius: radius.pill,
      backgroundColor: palette.track,
    },
    strengthSegmentFilled: { backgroundColor: palette.lime },
    checklist: { gap: spacing.md },
    requirement: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    backLink: { paddingVertical: spacing.md },
  })
);
