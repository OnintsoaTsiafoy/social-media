import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Avatar,
  Button,
  Callout,
  Card,
  Divider,
  DetailRow,
  Icon,
  ListRow,
  Screen,
  SelectField,
  Text,
  TextField,
  useFeedback,
} from '@/components/ui';
import { profile } from '@/data/api';
import { LANGUAGE_OPTIONS, TIMEZONE_OPTIONS } from '@/data/options';
import { useMutation } from '@/hooks/useAsync';
import { formatDate } from '@/lib/format';
import { validateDisplayName, validateName } from '@/lib/validation';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';
import type { Language } from '@/types';

/**
 * ÉCRAN 24 - Profil utilisateur (`/profile`)
 *
 * Read-only by default; "Modifier" switches the same screen into an editable
 * form. Leaving with unsaved edits asks for confirmation first.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { user, setUser, signOut } = useSession();
  const { confirm, toast } = useFeedback();
  const mutation = useMutation();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    displayName: user?.displayName ?? '',
    language: user?.language ?? ('fr' as Language),
    timezone: user?.timezone ?? 'Europe/Paris',
  });
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; displayName?: string }>({});

  const dirty =
    editing &&
    (draft.firstName !== user?.firstName ||
      draft.lastName !== user?.lastName ||
      draft.displayName !== user?.displayName ||
      draft.language !== user?.language ||
      draft.timezone !== user?.timezone);

  const startEditing = () => {
    setDraft({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      displayName: user?.displayName ?? '',
      language: user?.language ?? 'fr',
      timezone: user?.timezone ?? 'Europe/Paris',
    });
    setErrors({});
    setEditing(true);
  };

  const cancelEditing = async () => {
    if (dirty) {
      const confirmed = await confirm({
        title: 'Abandonner les modifications ?',
        message: 'Les modifications non enregistrées seront perdues.',
        confirmLabel: 'Abandonner',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setEditing(false);
  };

  const save = async () => {
    const next = {
      firstName: validateName(draft.firstName),
      lastName: validateName(draft.lastName),
      displayName: validateDisplayName(draft.displayName),
    };
    setErrors(next);
    if (next.firstName || next.lastName || next.displayName) return;

    const result = await mutation.run(() =>
      profile.update({
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        displayName: draft.displayName.trim() || `${draft.firstName.trim()} ${draft.lastName.trim()}`,
        language: draft.language,
        timezone: draft.timezone,
      })
    );
    if (!result.ok) return;

    setUser(result.data);
    setEditing(false);
    toast('Profil mis à jour.', 'success');
  };

  const handleBack = async () => {
    if (dirty) {
      const confirmed = await confirm({
        title: 'Quitter sans enregistrer ?',
        message: 'Les modifications non enregistrées seront perdues.',
        confirmLabel: 'Quitter',
        destructive: true,
      });
      if (!confirmed) return;
    }
    router.back();
  };

  const handleSignOut = async () => {
    const confirmed = await confirm({
      title: 'Se déconnecter ?',
      confirmLabel: 'Se déconnecter',
      destructive: true,
    });
    if (!confirmed) return;
    await signOut();
    router.replace('/login');
  };

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Profil"
          showBack
          onBack={handleBack}
          actionLabel={editing ? 'Annuler' : 'Modifier'}
          onActionPress={editing ? cancelEditing : startEditing}
        />
      }
      footer={
        editing ? (
          <Button label="Enregistrer" onPress={save} loading={mutation.pending} disabled={!dirty} block />
        ) : undefined
      }
    >
      <View style={styles.identity}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Changer la photo de profil"
          disabled={!editing}
          onPress={() => toast('La sélection d’avatar arrive dans une prochaine version.', 'info')}
        >
          <Avatar initials={user?.avatarInitials ?? '··'} size={88} ringed />
          {editing ? (
            <View style={styles.avatarEdit}>
              <Icon name="editProfile" size={14} color={palette.white} />
            </View>
          ) : null}
        </Pressable>

        <View style={styles.identityText}>
          <Text variant="title1" weight="extrabold" center>
            {user?.displayName ?? ''}
          </Text>
          <Text variant="body" color={palette.inkFaint} center style={styles.email}>
            {user?.email ?? ''}
          </Text>
        </View>
      </View>

      {editing ? (
        <View style={styles.form}>
          <View style={styles.row}>
            <TextField
              label="Prénom"
              value={draft.firstName}
              onChangeText={(value) => {
                setDraft((current) => ({ ...current, firstName: value }));
                setErrors((current) => ({ ...current, firstName: undefined }));
              }}
              error={errors.firstName}
              containerStyle={styles.rowItem}
            />
            <TextField
              label="Nom"
              value={draft.lastName}
              onChangeText={(value) => {
                setDraft((current) => ({ ...current, lastName: value }));
                setErrors((current) => ({ ...current, lastName: undefined }));
              }}
              error={errors.lastName}
              containerStyle={styles.rowItem}
            />
          </View>

          <TextField
            label="Nom affiché"
            value={draft.displayName}
            onChangeText={(value) => {
              setDraft((current) => ({ ...current, displayName: value }));
              setErrors((current) => ({ ...current, displayName: undefined }));
            }}
            error={errors.displayName}
          />

          <SelectField
            label="Langue"
            value={draft.language}
            options={LANGUAGE_OPTIONS as { value: Language; label: string }[]}
            onChange={(value) => setDraft((current) => ({ ...current, language: value }))}
          />

          <SelectField
            label="Fuseau horaire"
            value={draft.timezone}
            options={TIMEZONE_OPTIONS}
            onChange={(value) => setDraft((current) => ({ ...current, timezone: value }))}
          />

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

          <Callout tone="neutral" icon="info">
            L’email se modifie via une procédure de vérification dédiée.
          </Callout>
        </View>
      ) : (
        <>
          <Card style={styles.detailCard}>
            <DetailRow label="Prénom" value={user?.firstName ?? '-'} />
            <Divider />
            <DetailRow label="Nom" value={user?.lastName ?? '-'} />
            <Divider />
            <DetailRow label="Nom affiché" value={user?.displayName ?? '-'} />
            <Divider />
            <DetailRow
              label="Langue"
              value={LANGUAGE_OPTIONS.find((option) => option.value === user?.language)?.label ?? '-'}
            />
            <Divider />
            <DetailRow
              label="Fuseau horaire"
              value={TIMEZONE_OPTIONS.find((option) => option.value === user?.timezone)?.label ?? '-'}
            />
            <Divider />
            <DetailRow label="Compte créé le" value={user ? formatDate(user.createdAt) : '-'} />
          </Card>

          <Card padded={false}>
            <ListRow label="Changer le mot de passe" onPress={() => router.push('/settings/security')} />
          </Card>

          <Card padded={false}>
            <ListRow label="Se déconnecter" tone="danger" onPress={handleSignOut} showChevron={false} />
          </Card>

          <Text variant="micro" color={palette.inkPlaceholder}>
            L’email se modifie via une procédure de vérification dédiée.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: spacing['3xl'] },
  avatarEdit: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.night,
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { alignItems: 'center' },
  email: { marginTop: spacing.xs },
  form: { gap: spacing['3xl'] },
  row: { flexDirection: 'row', gap: spacing.xl },
  rowItem: { flex: 1 },
  detailCard: { gap: spacing.xl },
});
