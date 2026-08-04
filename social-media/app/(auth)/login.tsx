import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BrandMark } from '@/components/domain/BrandMark';
import { Button, Callout, Checkbox, PasswordField, Screen, Text, TextField } from '@/components/ui';
import { auth } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import { messages, normaliseEmail, validateEmail } from '@/lib/validation';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';

type Errors = { email?: string; password?: string };

/**
 * ÉCRAN 03 - Connexion (`/login`)
 *
 * The failure message is deliberately generic: it never reveals whether an
 * email address exists.
 */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const mutation = useMutation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<Errors>({});

  const validate = (): boolean => {
    const next: Errors = {
      email: validateEmail(email),
      password: password ? undefined : messages.required,
    };
    setErrors(next);
    return !next.email && !next.password;
  };

  const submit = async () => {
    if (!validate()) return;

    const result = await mutation.run(() =>
      auth.login({ email: normaliseEmail(email), password })
    );
    if (!result.ok) return;

    await signIn(result.data.token, result.data.user, result.data.refreshToken);
    router.replace('/home');
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <BrandMark />
        <View>
          <Text variant="display" weight="extrabold">
            Connexion
          </Text>
          <Text variant="footnote" color={palette.inkFaint} style={styles.subtitle}>
            Accédez à votre espace Community Manager.
          </Text>
        </View>
      </View>

      <View style={styles.form}>
        <TextField
          placeholder="Adresse email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
          }}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
          returnKeyType="next"
        />

        <PasswordField
          placeholder="Mot de passe"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
          }}
          error={errors.password}
          returnKeyType="go"
          onSubmitEditing={submit}
        />

        <View style={styles.optionsRow}>
          <Checkbox
            value={remember}
            onValueChange={setRemember}
            label="Se souvenir de moi"
          />
          <Text
            variant="body"
            weight="semibold"
            accessibilityRole="link"
            onPress={() => router.push('/forgot-password')}
          >
            Mot de passe oublié ?
          </Text>
        </View>

        {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

        <Button label="Se connecter" onPress={submit} loading={mutation.pending} block />

        <Button
          label="Créer un compte"
          variant="secondary"
          onPress={() => router.push('/register')}
          disabled={mutation.pending}
          block
        />
      </View>

      <View style={styles.spacer} />

    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing['4xl'], paddingTop: spacing['4xl'] },
  subtitle: { marginTop: spacing.sm, maxWidth: 320 },
  form: { gap: spacing['3xl'] },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xl,
  },
  spacer: { flex: 1, minHeight: spacing['4xl'] },
});
