import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  ErrorState,
  Screen,
  SelectField,
  SkeletonList,
  Text,
  TextField,
  intentMeta,
  networkMeta,
  priorityMeta,
  sentimentMeta,
  useFeedback,
} from '@/components/ui';
import { brandsApi, commentsApi } from '@/data/api';
import { LANGUAGE_OPTIONS, TONE_OPTIONS } from '@/data/options';
import { useAsync, useMutation, type MutationResult } from '@/hooks/useAsync';
import { excerpt } from '@/lib/format';
import { messages } from '@/lib/validation';
import { palette, spacing } from '@/theme';
import type { BrandTone } from '@/types';

const MAX_RESPONSE_LENGTH = 500;

/**
 * ÉCRAN 19 - Éditeur de réponse IA (`/comments/:id/response`)
 *
 * The only place a reply can be sent, and only after an explicit approval. The
 * original AI proposal is preserved; edits create a new version.
 */
export default function ResponseEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { confirm, toast } = useFeedback();

  const generation = useMutation();
  const saving = useMutation();
  const sending = useMutation();

  const request = useAsync(() => commentsApi.get(id), [id]);
  const brand = useAsync(() => brandsApi.getActive(), []);

  const [draft, setDraft] = useState<{ commentId: string; text: string; tone: BrandTone; language: string }>();
  const [instruction, setInstruction] = useState('');
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const comment = request.data;
  const response = comment?.response;

  // Derive defaults and validation during render. Writing derived state in
  // effects creates extra TextInput update cycles during fast Android typing.
  // A local draft survives a server refresh after a conflict.
  const localDraft = draft?.commentId === id ? draft : undefined;
  const text = localDraft?.text ?? response?.text ?? '';
  const tone = localDraft?.tone ?? response?.tone ?? brand.data?.tone ?? 'empathetic';
  const language = localDraft?.language ?? response?.language ?? 'auto';
  const patchDraft = (patch: Partial<NonNullable<typeof draft>>) =>
    setDraft({ commentId: id, text, tone, language, ...patch });
  const bannedHit = brand.data?.bannedTerms?.find((term) => text.toLowerCase().includes(term.toLowerCase()));

  const refreshOnConflict = async (result: MutationResult<unknown>) => {
    if (!result.ok && result.code === 'conflict') await request.refresh();
  };

  const alreadySent = response?.status === 'sent';
  const decided = alreadySent || response?.status === 'approved' || response?.status === 'rejected';
  const busy = generation.pending || saving.pending || sending.pending;
  const feedback = { reason: reason || undefined, rating: rating ? Number(rating) : undefined };
  const tooLong = text.length > MAX_RESPONSE_LENGTH;

  const generate = async () => {
    if (!comment) return;
    const result = await generation.run(() =>
      commentsApi.generateResponse(comment.id, { tone, language, instruction, suggestionId: response?.id })
    );
    if (!result.ok) { await refreshOnConflict(result); return; }
    request.setData({ ...comment, response: result.data });
    setDraft(undefined);
    toast('Nouvelle proposition générée.', 'success');
  };

  const validate = (): boolean => {
    if (!text.trim()) {
      setError(messages.responseRequired);
      return false;
    }
    if (tooLong) {
      setError(`La réponse dépasse ${MAX_RESPONSE_LENGTH} caractères.`);
      return false;
    }
    setError(undefined);
    return true;
  };

  const save = async () => {
    if (!comment || !validate()) return;
    const result = await saving.run(() =>
      commentsApi.saveResponse(
        comment.id,
        text.trim(),
        { tone, language: language === 'auto' ? undefined : language as 'fr' | 'en' | 'ar' },
        response?.id
      )
    );
    if (!result.ok) { await refreshOnConflict(result); return; }
    request.setData({ ...comment, response: result.data });
    setDraft(undefined);
    toast('Réponse enregistrée.', 'success');
  };

  const reject = async () => {
    if (!comment || !response) return;
    const confirmed = await confirm({
      title: 'Rejeter cette proposition ?',
      message: 'La proposition sera archivée dans l’historique et ne sera pas envoyée.',
      confirmLabel: 'Rejeter',
      destructive: true,
    });
    if (!confirmed) return;

    const result = await saving.run(() => commentsApi.rejectResponse(response.id, feedback));
    if (!result.ok) { await refreshOnConflict(result); return; }
    toast('Proposition rejetée.', 'info');
    router.back();
  };

  const accept = async () => {
    if (!comment || !response || !validate()) return;
    const result = await saving.run(() => commentsApi.acceptResponse(response.id, text.trim(), feedback));
    if (!result.ok) { await refreshOnConflict(result); return; }
    request.setData({ ...comment, response: result.data });
    setDraft(undefined);
    toast('Réponse validée. Vous pouvez maintenant l’envoyer.', 'success');
  };

  const approveAndSend = async () => {
    if (!comment || !validate()) return;

    // Le serveur refuse d'approuver une proposition bloquée ; on le dit ici
    // plutôt que de laisser partir une requête vouée au 409. Si le texte a été
    // modifié depuis, on laisse faire : l'approbation recontrôle la nouvelle
    // version, et la correction a peut-être levé le blocage.
    if (response?.blocked && text.trim() === response.text) {
      setError('Corrigez les points signalés avant d’approuver cette réponse.');
      return;
    }

    if (bannedHit) {
      const proceed = await confirm({
        title: 'Terme interdit détecté',
        message: `La réponse contient « ${bannedHit} », listé comme terme interdit pour cette marque. Envoyer quand même ?`,
        confirmLabel: 'Envoyer quand même',
        destructive: true,
      });
      if (!proceed) return;
    }

    const confirmed = await confirm({
      title: 'Envoyer cette réponse ?',
      message: `Elle sera publiée publiquement sur ${networkMeta[comment.network].label} en réponse à ${comment.authorName}.`,
      confirmLabel: 'Approuver & envoyer',
    });
    if (!confirmed) return;

    const result = await sending.run(() =>
      commentsApi.approveAndSend(comment.id, text.trim(), response?.id, feedback)
    );
    if (!result.ok) { await refreshOnConflict(result); return; }

    toast('Réponse envoyée.', 'success');
    router.replace(`/comments/${comment.id}`);
  };

  const analysis = comment?.analysis;

  return (
    <Screen
      scroll
      header={
        <AppHeader
          title="Réponse"
          showBack
          actionLabel="Copier"
          onActionPress={() => toast('Réponse copiée.', 'info')}
          actionDisabled={!text.trim()}
        />
      }
      footer={
        comment && !alreadySent ? (
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Button
                label="Rejeter"
                variant="danger"
                size="sm"
                onPress={reject}
                disabled={busy || decided || !response}
                style={styles.footerButton}
              />
              <Button
                label="Enregistrer le brouillon"
                variant="secondary"
                size="sm"
                onPress={save}
                loading={saving.pending}
                disabled={busy || decided}
                style={styles.footerButton}
              />
            </View>
            <Button
              label={response?.status === 'approved' ? 'Réponse validée' : text.trim() === response?.text ? 'Accepter' : 'Valider la modification'}
              variant="secondary"
              onPress={accept}
              disabled={busy || decided || !response || !text.trim() || tooLong || (response.blocked && text.trim() === response.text)}
              block
            />
            <Button
              label={response?.status === 'approved' ? 'Envoyer la réponse validée' : 'Approuver & envoyer'}
              variant="accent"
              onPress={approveAndSend}
              loading={sending.pending}
              disabled={busy || !text.trim() || tooLong || response?.status === 'rejected' || (response?.blocked && text.trim() === response.text)}
              block
            />
          </View>
        ) : undefined
      }
    >
      {request.loading ? (
        <SkeletonList count={3} withThumbnail={false} />
      ) : request.error ? (
        <ErrorState message={request.error} onRetry={request.reload} />
      ) : comment ? (
        <>
          {/* Context: the comment being answered */}
          <Card tone="muted" style={styles.contextCard}>
            <Avatar initials={comment.authorInitials} size={32} />
            <View style={styles.contextText}>
              <Text variant="body" weight="bold">
                {comment.authorName} · {networkMeta[comment.network].label}
              </Text>
              <Text variant="footnote" color={palette.inkMuted} numberOfLines={3}>
                « {excerpt(comment.text, 140)} »
              </Text>
              {analysis ? (
                <View style={styles.contextBadges}>
                  <Badge
                    label={sentimentMeta[analysis.sentiment].label}
                    tone={sentimentMeta[analysis.sentiment].tone}
                  />
                  <Badge label={intentMeta[analysis.intent].label} tone="neutral" />
                  <Badge
                    label={priorityMeta[analysis.priority].label}
                    tone={priorityMeta[analysis.priority].tone}
                  />
                </View>
              ) : null}
            </View>
          </Card>

          {alreadySent ? (
            <Callout tone="success" icon="checkCircle" title="Réponse déjà envoyée">
              Cette réponse a été publiée. Consultez l’historique pour voir la version envoyée.
            </Callout>
          ) : null}

          <TextField
            label="Réponse"
            counter={`${text.length} / ${MAX_RESPONSE_LENGTH}`}
            value={text}
            onChangeText={(value) => {
              patchDraft({ text: value });
              setError(undefined);
            }}
            error={error}
            placeholder="Rédigez ou ajustez la réponse…"
            multiline
            editable={!decided && !busy}
          />

          {bannedHit ? (
            <Callout tone="warning" icon="priority">
              La réponse contient « {bannedHit} », listé comme terme interdit dans les paramètres de
              marque.
            </Callout>
          ) : null}

          {/* Contrôle de sécurité du serveur, recalculé à chaque version
              enregistrée — y compris sur un texte réécrit à la main. Un
              avertissement « blocking » empêche l'approbation. */}
          {(response?.warnings ?? []).map((warning) => (
            <Callout
              key={warning.code}
              tone={warning.severity === 'blocking' ? 'danger' : warning.severity === 'warning' ? 'warning' : 'neutral'}
              icon={warning.severity === 'info' ? 'info' : 'priority'}
            >
              {warning.message}
            </Callout>
          ))}

          {response?.confidenceScore != null ? (
            <Card>
              <Text weight="bold">Confiance documentaire : {Math.round(response.confidenceScore * 100)} %</Text>
              <Text variant="footnote">{response.confidenceScore >= 0.85 ? 'Élevée' : response.confidenceScore >= 0.70 ? 'Moyenne' : 'Faible'} · proximité des sources, à vérifier avant envoi.</Text>
              {(response.sources ?? []).map((source) => (
                <Text key={source.chunkId} variant="footnote">• {source.title} · {Math.round(source.score * 100)} %</Text>
              ))}
              {response.similarExamples?.length ? <Text variant="footnote">{response.similarExamples.length} réponses validées similaires utilisées pour le style.</Text> : null}
            </Card>
          ) : null}

          {!decided ? <>
            <SelectField label="Motif du feedback (facultatif)" value={reason} onChange={setReason} options={[
              { value: '', label: 'Sans motif' }, ...['Trop longue', 'Trop courte', 'Ton incorrect', 'Information incorrecte', 'Manque de personnalisation', 'Pas assez empathique', 'Réponse non pertinente', 'Mauvaise langue', 'Autre'].map((value) => ({ value, label: value })),
            ]} />
            <SelectField label="Satisfaction (facultative)" value={rating} onChange={setRating} options={[
              { value: '', label: 'Sans note' }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} / 5` })),
            ]} />
          </> : null}

          <View style={styles.row}>
            <SelectField
              label="Ton"
              value={tone}
              options={TONE_OPTIONS}
              onChange={(value) => patchDraft({ tone: value })}
              disabled={alreadySent}
              containerStyle={styles.rowItem}
            />
            <SelectField
              label="Langue"
              value={language}
              options={[{ value: 'auto', label: 'Langue du commentaire' }, ...LANGUAGE_OPTIONS]}
              onChange={(value) => patchDraft({ language: value })}
              disabled={alreadySent}
              containerStyle={styles.rowItem}
            />
          </View>

          <TextField
            label="Instruction complémentaire"
            value={instruction}
            onChangeText={setInstruction}
            placeholder="Ex. « utiliser un ton plus empathique »"
            multiline
            editable={!alreadySent}
          />

          <Button
            label={response ? 'Régénérer la réponse' : 'Générer une réponse'}
            variant="secondary"
            icon="regenerate"
            onPress={generate}
            loading={generation.pending}
            disabled={alreadySent || busy}
            block
          />

          {generation.error ? <Callout tone="warning">{generation.error}</Callout> : null}
          {sending.error ? <Callout tone="danger">{sending.error}</Callout> : null}
          {saving.error ? <Callout tone="danger">{saving.error}</Callout> : null}

          <Callout tone="warning" icon="ai">
            Cette réponse a été générée par une intelligence artificielle. Vérifiez-la avant de
            l’envoyer.
          </Callout>

          {response && response.originalText !== text ? (
            <Card tone="muted" style={styles.originalCard}>
                <Text variant="eyebrow">Proposition d’origine (v1)</Text>
              <Text variant="footnote" color={palette.inkMuted}>
                « {response.originalText} »
              </Text>
              <Text
                variant="body"
                weight="bold"
                accessibilityRole="button"
                onPress={() => router.push(`/comments/${comment.id}/history`)}
              >
                Comparer les versions
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  contextCard: { flexDirection: 'row', gap: spacing.xl },
  contextText: { flex: 1, gap: spacing.md },
  contextBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.xl },
  rowItem: { flex: 1 },
  originalCard: { gap: spacing.md },
  footer: { gap: spacing.lg },
  footerRow: { flexDirection: 'row', gap: spacing.lg },
  footerButton: { flex: 1 },
});
