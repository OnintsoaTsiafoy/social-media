import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, Button, Callout, Screen, Text, TextField } from '@/components/ui';
import { auth } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import { normaliseEmail, validateEmail } from '@/lib/validation';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 04 - Mot de passe oublié (`/forgot-password`)
 *
 * Always reports the same generic outcome, so the screen cannot be used to
 * discover which addresses have an account.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const mutation = useMutation();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const validationError = validateEmail(email);
    setError(validationError);
    if (validationError) return;

    const result = await mutation.run(() => auth.requestPasswordReset(normaliseEmail(email)));
    if (result.ok) setSent(true);
  };

  return (
    <Screen scroll header={<AppHeader title="Mot de passe oublié" showBack />}>
      <View style={styles.intro}>
        <Text variant="display" weight="extrabold">
          Mot de passe oublié
        </Text>
        <Text variant="footnote" color={palette.inkFaint} style={styles.subtitle}>
          Saisissez votre adresse email. Nous vous enverrons un lien de réinitialisation.
        </Text>
      </View>

      <View style={styles.form}>
        <TextField
          placeholder="Adresse email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setError(undefined);
            setSent(false);
          }}
          error={error}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={submit}
          editable={!mutation.pending}
        />

        <Button
          label="Envoyer le lien de réinitialisation"
          onPress={submit}
          loading={mutation.pending}
          block
        />

        {sent ? (
          <Callout tone="success" icon="checkCircle">
            Si un compte correspond à cette adresse, un lien de réinitialisation sera envoyé.
          </Callout>
        ) : null}

        {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

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

const styles = StyleSheet.create({
  intro: { paddingTop: spacing.md },
  subtitle: { marginTop: spacing.md, maxWidth: 340 },
  form: { gap: spacing['3xl'] },
  backLink: { paddingVertical: spacing.md },
});
