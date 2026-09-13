import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BottomSheet,
  Button,
  Callout,
  Card,
  Chip,
  ChipWrap,
  LoadingState,
  Text,
  TextField,
  useFeedback,
} from '@/components/ui';
import { publicationsApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { MAX_HASHTAGS, mergeHashtags, normaliseHashtag } from '@/lib/validation';
import { useComposer } from '@/store/ComposerProvider';
import { palette, spacing } from '@/theme';

/**
 * ÉCRAN 11 - Génération et sélection des hashtags (panneau inférieur)
 *
 * Manual hashtags are kept separate from generated ones so a regeneration can
 * never silently drop what the user typed.
 */
export default function HashtagsScreen() {
  const router = useRouter();
  const { draft, patch } = useComposer();
  const { confirm, toast } = useFeedback();
  const generation = useMutation();

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>(draft.hashtags);
  const [manual, setManual] = useState('');

  const keywords = useAsync(
    () => publicationsApi.detectKeywords(draft.text, draft.brandId),
    [draft.text, draft.brandId]
  );

  const generate = useCallback(async () => {
    // `selected` est transmis pour que le serveur renvoie d'abord ce que
    // l'utilisateur a déjà retenu : une régénération ne doit jamais faire
    // disparaître un hashtag saisi à la main.
    const result = await generation.run(() =>
      publicationsApi.generateHashtags(draft.text, draft.brandId, selected)
    );
    if (!result.ok) return;
    setSuggestions(result.data);
    if (result.data.length === 0) toast('Aucun hashtag n’a pu être généré.', 'info');
    // `generation` is a stable-enough wrapper; only the draft text matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.text, draft.brandId, selected]);

  // Generate once on open, when the draft already has text to work from.
  useEffect(() => {
    if (draft.text.trim()) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (hashtag: string) => {
    setSelected((current) =>
      current.includes(hashtag)
        ? current.filter((item) => item !== hashtag)
        : current.length >= MAX_HASHTAGS
          ? current
          : [...current, hashtag]
    );
    if (selected.length >= MAX_HASHTAGS && !selected.includes(hashtag)) {
      toast(`Maximum ${MAX_HASHTAGS} hashtags.`, 'info');
    }
  };

  const addManual = () => {
    const normalised = normaliseHashtag(manual);
    if (!normalised) {
      toast('Ce hashtag n’est pas valide.', 'error');
      return;
    }
    if (selected.includes(normalised)) {
      toast('Ce hashtag est déjà sélectionné.', 'info');
      setManual('');
      return;
    }
    if (selected.length >= MAX_HASHTAGS) {
      toast(`Maximum ${MAX_HASHTAGS} hashtags.`, 'info');
      return;
    }
    setSelected((current) => [...current, normalised]);
    setManual('');
  };

  const clearAll = async () => {
    const manualOnes = selected.filter((hashtag) => !suggestions.includes(hashtag));
    if (manualOnes.length > 0) {
      const confirmed = await confirm({
        title: 'Tout désélectionner ?',
        message: `${manualOnes.length} hashtag${manualOnes.length > 1 ? 's' : ''} ajouté${manualOnes.length > 1 ? 's' : ''} manuellement ${manualOnes.length > 1 ? 'seront retirés' : 'sera retiré'}.`,
        confirmLabel: 'Tout désélectionner',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setSelected([]);
  };

  const apply = () => {
    patch({ hashtags: mergeHashtags(selected, []) });
    router.back();
  };

  const pool = mergeHashtags([...selected, ...suggestions], []);

  return (
    <BottomSheet
      visible
      onClose={() => router.back()}
      title="Hashtags proposés"
      headerAction={
        <Button
          label="Régénérer"
          variant="ghost"
          size="sm"
          icon="regenerate"
          onPress={generate}
          loading={generation.pending}
        />
      }
      footer={<Button label="Appliquer" onPress={apply} block />}
    >
      <View style={styles.body}>
        <Card tone="muted">
          <Text variant="footnote" color={palette.inkMuted}>
            Mots-clés détectés :{' '}
            {keywords.loading
              ? '…'
              : (keywords.data ?? []).length > 0
                ? keywords.data?.join(' · ')
                : 'aucun mot-clé détecté'}
          </Text>
        </Card>

        {generation.pending ? (
          <LoadingState label="Génération des hashtags…" compact />
        ) : generation.error ? (
          <Callout tone="warning" icon="priority">
            {generation.error} Vous pouvez saisir vos hashtags manuellement ci-dessous.
          </Callout>
        ) : pool.length === 0 ? (
          <Callout tone="neutral" icon="info">
            Aucun hashtag proposé pour le moment. Rédigez du contenu puis relancez la génération, ou
            ajoutez vos hashtags manuellement.
          </Callout>
        ) : (
          <ChipWrap>
            {pool.map((hashtag) => (
              <Chip
                key={hashtag}
                label={hashtag}
                variant="choice"
                selected={selected.includes(hashtag)}
                onPress={() => toggle(hashtag)}
              />
            ))}
          </ChipWrap>
        )}

        <View style={styles.manualRow}>
          <TextField
            value={manual}
            onChangeText={setManual}
            placeholder="Ajouter un hashtag manuel"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={addManual}
            containerStyle={styles.manualField}
          />
          <Button label="Ajouter" variant="secondary" size="sm" onPress={addManual} disabled={!manual.trim()} />
        </View>

        <View style={styles.countRow}>
          <Text variant="footnote" color={palette.inkMuted}>
            <Text variant="footnote" weight="bold">
              {selected.length}
            </Text>{' '}
            sélectionné{selected.length > 1 ? 's' : ''} · max {MAX_HASHTAGS}
          </Text>
          <Text
            variant="footnote"
            weight="bold"
            accessibilityRole="button"
            onPress={selected.length > 0 ? clearAll : () => setSelected(pool.slice(0, MAX_HASHTAGS))}
          >
            {selected.length > 0 ? 'Tout désélectionner' : 'Tout sélectionner'}
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing['3xl'] },
  manualRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  manualField: { flex: 1 },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xl,
  },
});
