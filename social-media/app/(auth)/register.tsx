import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BrandMark } from '@/components/domain/BrandMark';
import {
  Button,
  Callout,
  Checkbox,
  PasswordField,
  Screen,
  SelectField,
  Text,
  TextField,
  useFeedback,
} from '@/components/ui';
import { auth } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import {
  messages,
  normaliseEmail,
  validateConfirmation,
  validateDisplayName,
  validateEmail,
  validateName,
  validatePassword,
} from '@/lib/validation';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';

import { LANGUAGE_OPTIONS, TIMEZONE_OPTIONS } from '@/data/options';

type Fields = {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  password: string;
  confirmation: string;
};

type Errors = Partial<Record<keyof Fields | 'terms' | 'privacy', string>>;

/**
 * ÉCRAN 02 - Inscription (`/register`)
 *
 * On success the user is signed in straight away, then landed on the dashboard
 * with an invitation to connect a first social account.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const { toast } = useFeedback();
  const mutation = useMutation();

  const [fields, setFields] = useState<Fields>({
    firstName: '',
    lastName: '',
    displayName: '',
    email: '',
    password: '',
    confirmation: '',
  });
  const [language, setLanguage] = useState('fr');
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  const set = (key: keyof Fields) => (value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    // Clear the field's error as soon as the user edits it.
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: Errors = {
      firstName: validateName(fields.firstName),
      lastName: validateName(fields.lastName),
      displayName: validateDisplayName(fields.displayName),
      email: validateEmail(fields.email),
      password: validatePassword(fields.password),
      confirmation: validateConfirmation(fields.password, fields.confirmation),
      terms: terms ? undefined : messages.termsRequired,
      privacy: privacy ? undefined : messages.privacyRequired,
    };
    setErrors(next);
    return Object.values(next).every((value) => value === undefined);
  };

  const submit = async () => {
    if (!validate()) return;

    const result = await mutation.run(() =>
      auth.register({
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        displayName: fields.displayName.trim() || undefined,
        email: normaliseEmail(fields.email),
        password: fields.password,
        language,
        timezone,
      })
    );
    if (!result.ok) return;

    await signIn(result.data.token, result.data.user, result.data.refreshToken);
    toast('Votre compte a été créé avec succès.', 'success');
    router.replace('/home');
  };

  return (
    <Screen scroll>
      <View style={styles.header}>
        <BrandMark size={38} />
        <View>
          <Text variant="display" weight="extrabold">
            Créer un compte
          </Text>
          <Text variant="footnote" color={palette.inkFaint} style={styles.subtitle}>
            Gérez vos publications, commentaires et performances depuis une seule application.
          </Text>
        </View>
      </View>

      <View style={styles.form}>
        <View style={styles.row}>
          <TextField
            placeholder="Prénom"
            value={fields.firstName}
            onChangeText={set('firstName')}
            error={errors.firstName}
            autoComplete="given-name"
            textContentType="givenName"
            containerStyle={styles.rowItem}
          />
          <TextField
            placeholder="Nom"
            value={fields.lastName}
            onChangeText={set('lastName')}
            error={errors.lastName}
            autoComplete="family-name"
            textContentType="familyName"
            containerStyle={styles.rowItem}
          />
        </View>

        <TextField
          placeholder="Nom affiché (optionnel)"
          value={fields.displayName}
          onChangeText={set('displayName')}
          error={errors.displayName}
          hint="Visible par votre équipe. 2 à 100 caractères."
        />

        <TextField
          placeholder="Adresse email"
          value={fields.email}
          onChangeText={set('email')}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          autoCorrect={false}
        />

        <PasswordField
          placeholder="Mot de passe"
          value={fields.password}
          onChangeText={set('password')}
          error={errors.password}
          hint={messages.passwordPolicy}
        />

        <PasswordField
          placeholder="Confirmation du mot de passe"
          value={fields.confirmation}
          onChangeText={set('confirmation')}
          error={errors.confirmation}
        />

        <View style={styles.row}>
          <SelectField
            label="Langue"
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={setLanguage}
            containerStyle={styles.rowItem}
          />
          <SelectField
            label="Fuseau horaire"
            value={timezone}
            options={TIMEZONE_OPTIONS}
            onChange={setTimezone}
            containerStyle={styles.rowItem}
          />
        </View>

        <View style={styles.consents}>
          <Checkbox
            value={terms}
            onValueChange={(value) => {
              setTerms(value);
              setErrors((current) => ({ ...current, terms: undefined }));
            }}
            label="J’accepte les conditions d’utilisation"
            error={errors.terms}
          >
            <Text variant="footnote" color={palette.inkMuted}>
              J’accepte les{' '}
              <Text
                variant="footnote"
                weight="bold"
                accessibilityRole="link"
                onPress={() => router.push('/legal/terms')}
              >
                conditions d’utilisation
              </Text>
            </Text>
          </Checkbox>

          <Checkbox
            value={privacy}
            onValueChange={(value) => {
              setPrivacy(value);
              setErrors((current) => ({ ...current, privacy: undefined }));
            }}
            label="J’accepte la politique de confidentialité"
            error={errors.privacy}
          >
            <Text variant="footnote" color={palette.inkMuted}>
              J’accepte la{' '}
              <Text
                variant="footnote"
                weight="bold"
                accessibilityRole="link"
                onPress={() => router.push('/legal/privacy')}
              >
                politique de confidentialité
              </Text>
            </Text>
          </Checkbox>
        </View>

        {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

        <Button label="Créer mon compte" onPress={submit} loading={mutation.pending} block />

        <Text variant="body" color={palette.inkMuted} center>
          J’ai déjà un compte ·{' '}
          <Text
            variant="body"
            weight="bold"
            accessibilityRole="link"
            onPress={() => router.replace('/login')}
          >
            Connexion
          </Text>
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing['3xl'], paddingTop: spacing['3xl'] },
  subtitle: { marginTop: spacing.sm },
  form: { gap: spacing['3xl'] },
  row: { flexDirection: 'row', gap: spacing.xl },
  rowItem: { flex: 1 },
  consents: { gap: spacing.md },
});
