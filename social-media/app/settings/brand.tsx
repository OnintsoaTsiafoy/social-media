import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Card,
  Chip,
  ChipWrap,
  Divider,
  ErrorState,
  Screen,
  SelectField,
  SkeletonList,
  Text,
  TextField,
  Toggle,
  useFeedback,
} from '@/components/ui';
import { brandsApi } from '@/data/api';
import {
  LANGUAGE_OPTIONS,
  SECTOR_OPTIONS,
  TARGET_LENGTH_OPTIONS,
  TONE_OPTIONS,
} from '@/data/options';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { palette, spacing } from '@/theme';
import type { Brand, BrandTone, Language } from '@/types';

/**
 * ÉCRAN 25 - Paramètres de marque et ton IA (`/settings/brand`)
 *
 * These values are the context sent to the AI service on every generation, so
 * the screen states that explicitly rather than leaving it implicit.
 */
export default function BrandSettingsScreen() {
  const router = useRouter();
  const { confirm, toast } = useFeedback();
  const mutation = useMutation();

  const request = useAsync(() => brandsApi.getActive(), []);
  const [draft, setDraft] = useState<Brand | undefined>(undefined);
  const [newTerm, setNewTerm] = useState('');

  // Seed the editable copy once the brand has loaded, and re-seed after a reload.
  useEffect(() => {
    if (request.data) setDraft(request.data);
  }, [request.data]);

  const brand = draft ?? request.data;
  const dirty = Boolean(draft && request.data && JSON.stringify(draft) !== JSON.stringify(request.data));

  const patch = (changes: Partial<Brand>) =>
    setDraft((current) => (current ? { ...current, ...changes } : current));

  const save = async () => {
    if (!draft) return;
    const result = await mutation.run(() => brandsApi.update(draft.id, draft));
    if (!result.ok) return;

    request.setData(result.data);
    setDraft(result.data);
    toast('Paramètres de marque enregistrés.', 'success');
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

  const restore = async () => {
    const confirmed = await confirm({
      title: 'Restaurer les valeurs enregistrées ?',
      message: 'Vos modifications en cours seront annulées.',
      confirmLabel: 'Restaurer',
    });
    if (confirmed && request.data) setDraft(request.data);
  };

  const addBannedTerm = () => {
    const term = newTerm.trim();
    if (!term || !draft) return;
    if (draft.bannedTerms.includes(term)) {
      toast('Ce terme est déjà dans la liste.', 'info');
      return;
    }
    patch({ bannedTerms: [...draft.bannedTerms, term] });
    setNewTerm('');
  };

  const removeBannedTerm = async (term: string) => {
    const confirmed = await confirm({
      title: 'Retirer ce terme ?',
      message: `« ${term} » redeviendra autorisé dans les réponses générées.`,
      confirmLabel: 'Retirer',
      destructive: true,
    });
    if (confirmed && draft) {
      patch({ bannedTerms: draft.bannedTerms.filter((item) => item !== term) });
    }
  };

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Marque & ton IA"
          showBack
          onBack={handleBack}
          actionLabel="Restaurer"
          onActionPress={restore}
          actionDisabled={!dirty}
        />
      }
      footer={
        brand ? (
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
      ) : brand ? (
        <>
          <View style={styles.section}>
            <Text variant="eyebrow">Identité</Text>
            <TextField
              value={brand.name}
              onChangeText={(value) => patch({ name: value })}
              placeholder="Nom de la marque"
            />
            <TextField
              value={brand.description}
              onChangeText={(value) => patch({ description: value })}
              placeholder="Description de la marque"
              multiline
            />
            <View style={styles.row}>
              <SelectField
                label="Langue principale"
                value={brand.primaryLanguage}
                options={LANGUAGE_OPTIONS as { value: Language; label: string }[]}
                onChange={(value) => patch({ primaryLanguage: value })}
                containerStyle={styles.rowItem}
              />
              <SelectField
                label="Secteur"
                value={brand.sector}
                options={SECTOR_OPTIONS}
                onChange={(value) => patch({ sector: value })}
                containerStyle={styles.rowItem}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text variant="eyebrow">Ton des réponses</Text>
            <ChipWrap>
              {TONE_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  variant="choice"
                  selected={brand.tone === option.value}
                  onPress={() => patch({ tone: option.value as BrandTone })}
                />
              ))}
            </ChipWrap>

            {brand.tone === 'custom' ? (
              <TextField
                label="Description du ton"
                value={brand.customTone ?? ''}
                onChangeText={(value) => patch({ customTone: value })}
                placeholder="Ex. « direct, sans jargon, une pointe d’humour »"
                multiline
              />
            ) : null}
          </View>

          <View style={styles.section}>
            <Text variant="eyebrow">Règles de rédaction</Text>
            <Card style={styles.rulesCard}>
              <Toggle
                label="Tutoiement"
                description="Tutoyer les personnes qui commentent."
                value={brand.useInformalAddress}
                onValueChange={(value) => patch({ useInformalAddress: value })}
              />
              <Divider />
              <Toggle
                label="Emojis autorisés"
                value={brand.emojisAllowed}
                onValueChange={(value) => patch({ emojisAllowed: value })}
              />
              <Divider />
              <SelectField
                label="Longueur cible"
                value={brand.targetLength}
                options={TARGET_LENGTH_OPTIONS}
                onChange={(value) => patch({ targetLength: value })}
              />
            </Card>

            <TextField
              label="Salutation"
              value={brand.greeting}
              onChangeText={(value) => patch({ greeting: value })}
              placeholder="Bonjour {prénom},"
            />
            <TextField
              label="Conclusion"
              value={brand.closing}
              onChangeText={(value) => patch({ closing: value })}
              placeholder="À très vite !"
            />
          </View>

          <View style={styles.section}>
            <Text variant="eyebrow">Termes interdits</Text>
            <ChipWrap>
              {brand.bannedTerms.map((term) => (
                <Chip
                  key={term}
                  label={`« ${term} » ✕`}
                  variant="tag"
                  onPress={() => removeBannedTerm(term)}
                />
              ))}
              {brand.bannedTerms.length === 0 ? (
                <Text variant="footnote" color={palette.inkFaint}>
                  Aucun terme interdit pour le moment.
                </Text>
              ) : null}
            </ChipWrap>

            <View style={styles.addRow}>
              <TextField
                value={newTerm}
                onChangeText={setNewTerm}
                placeholder="Ajouter un terme interdit"
                onSubmitEditing={addBannedTerm}
                returnKeyType="done"
                containerStyle={styles.addField}
              />
              <Button
                label="Ajouter"
                variant="secondary"
                size="sm"
                onPress={addBannedTerm}
                disabled={!newTerm.trim()}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text variant="eyebrow">Procédures métier</Text>
            <TextField
              label="Règle d’escalade"
              value={brand.escalationRule}
              onChangeText={(value) => patch({ escalationRule: value })}
              placeholder="Quand faut-il escalader un commentaire ?"
              multiline
            />
          </View>

          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}

          <Callout tone="success" icon="ai">
            Ces règles sont envoyées au service IA à chaque génération de réponse.
          </Callout>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.xl },
  rowItem: { flex: 1 },
  rulesCard: { gap: spacing.xl },
  addRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  addField: { flex: 1 },
});
