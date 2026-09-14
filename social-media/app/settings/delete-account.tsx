import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Card,
  Checkbox,
  Icon,
  PasswordField,
  Screen,
  Text,
  TextField,
  useFeedback,
} from '@/components/ui';
import { auth } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';

/** Typed exactly, it is the last guard before an irreversible action. */
const CONFIRMATION_WORD = 'SUPPRIMER';

const DELETED = [
  'Profil et préférences',
  'Publications, médias et brouillons',
  'Commentaires importés et analyses IA',
  'Accès aux comptes Facebook / Instagram',
];

/**
 * ÉCRAN 31 - Suppression du compte (`/settings/delete-account`)
 *
 * Triple confirmation: password, typed keyword, and an explicit checkbox - then
 * a final dialog. The button stays disabled until all three are satisfied.
 */
export default function DeleteAccountScreen() {
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const { signOut } = useSession();
  const mutation = useMutation();

  const [password, setPassword] = useState('');
  const [word, setWord] = useState('');
  const [understood, setUnderstood] = useState(false);

  const wordMatches = word.trim().toUpperCase() === CONFIRMATION_WORD;
  const ready = password.length > 0 && wordMatches && understood;

  const submit = async () => {
    if (!ready) return;

    const confirmed = await confirm({
      title: 'Supprimer définitivement votre compte ?',
      message:
        'Cette action est irréversible. Vos publications planifiées seront annulées et vos comptes sociaux déconnectés.',
      confirmLabel: 'Supprimer définitivement',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await mutation.run(() => auth.deleteAccount(password));
    if (!result.ok) return;

    await signOut();
    toast('Votre compte a été supprimé.', 'info');
    router.replace('/login');
  };

  return (
    <Screen
      scroll
      header={<AppHeader title="Supprimer mon compte" showBack />}
      footer={
        <View style={styles.footer}>
          <Button
            label="Supprimer définitivement"
            variant={ready ? 'danger' : 'secondary'}
            onPress={submit}
            loading={mutation.pending}
            disabled={!ready}
            block
          />
          <Button label="Annuler" variant="ghost" onPress={() => router.back()} block />
        </View>
      }
    >
      <Callout tone="danger" icon="priority">
        Cette action est définitive. Vos publications planifiées seront annulées et vos comptes
        sociaux déconnectés.
      </Callout>

      <Card style={styles.card}>
        <Text variant="eyebrow">Supprimé</Text>
        {DELETED.map((item) => (
          <View key={item} style={styles.listItem}>
            <Icon name="close" size={14} color={palette.dangerText} />
            <Text variant="footnote" color={palette.inkBody} style={styles.listText}>
              {item}
            </Text>
          </View>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text variant="eyebrow">Conservé (obligation légale)</Text>
        <Text variant="footnote" color={palette.inkMuted}>
          Journaux techniques anonymisés · 12 mois. Ils ne contiennent aucune donnée permettant de
          vous identifier.
        </Text>
      </Card>

      {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

      <View style={styles.form}>
        <PasswordField
          label="Mot de passe"
          placeholder="Votre mot de passe"
          value={password}
          onChangeText={setPassword}
        />

        <TextField
          label={`Saisir « ${CONFIRMATION_WORD} »`}
          placeholder={CONFIRMATION_WORD}
          value={word}
          onChangeText={setWord}
          autoCapitalize="characters"
          autoCorrect={false}
          hint={
            word.length > 0 && !wordMatches
              ? undefined
              : `Tapez ${CONFIRMATION_WORD} en majuscules pour confirmer.`
          }
          error={word.length > 0 && !wordMatches ? 'Le texte ne correspond pas.' : undefined}
        />

        <Checkbox
          value={understood}
          onValueChange={setUnderstood}
          label="Je comprends que cette action est irréversible."
        />
      </View>

      <Callout tone="neutral" icon="shield">
        À la suppression, les jetons d’accès sociaux sont révoqués côté serveur et toutes vos sessions
        sont fermées.
      </Callout>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  listText: { flex: 1 },
  form: { gap: spacing['3xl'] },
  footer: { gap: spacing.md },
});
