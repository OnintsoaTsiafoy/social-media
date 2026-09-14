import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { AppHeader, Button, Callout, ErrorState, Screen, SelectField, SkeletonList, Text, TextField, Toggle, useFeedback } from '@/components/ui';
import { knowledgeApi } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { useSession } from '@/store/SessionProvider';

const types = [
  { value: 'FAQ', label: 'FAQ' }, { value: 'PRODUCT', label: 'Produit' }, { value: 'SERVICE', label: 'Service' },
  { value: 'POLICY', label: 'Politique commerciale' }, { value: 'SAV', label: 'Service après-vente' },
  { value: 'GUIDELINE', label: 'Consignes et modération' }, { value: 'BRAND_TONE', label: 'Ton de la marque' }, { value: 'OTHER', label: 'Autre' },
];

export default function KnowledgeEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const { brand } = useSession();
  const { confirm, toast } = useFeedback();
  const request = useAsync(() => isNew ? Promise.resolve(null) : knowledgeApi.get(id), [id]);
  const mutation = useMutation();
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('FAQ');
  const [content, setContent] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (request.data) {
      setTitle(request.data.title); setDocumentType(request.data.documentType);
      setContent(request.data.content ?? ''); setInternal(request.data.internal);
    }
  }, [request.data]);

  const pickFile = async () => {
    const selected = await mutation.run(() => DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/csv'],
      copyToCacheDirectory: true, multiple: false,
    }));
    if (!selected.ok || selected.data.canceled) return;
    const asset = selected.data.assets[0];
    if (!asset) return;
    setFile(asset);
    if (!title) setTitle(asset.name.replace(/\.[^.]+$/, ''));
  };
  const save = async () => {
    if (!brand || !title.trim() || (!file && !content.trim())) {
      setFormError('Renseignez un titre et un texte ou un fichier.'); return;
    }
    setFormError('');
    const input = { title: title.trim(), documentType, content, internal };
    const result = await mutation.run(() => isNew
      ? file ? knowledgeApi.upload(brand.id, input, file) : knowledgeApi.create(brand.id, input)
      : knowledgeApi.update(id, request.data!.revision, input));
    if (!result.ok) return;
    toast(result.data.status === 'READY' ? 'Document indexé.' : 'Document enregistré. L’indexation pourra être relancée.', result.data.status === 'READY' ? 'success' : 'info');
    if (isNew) router.replace(`/knowledge/${result.data.id}`);
    else request.setData(result.data);
    setFile(null);
  };
  const remove = async () => {
    if (!await confirm({ title: 'Supprimer ce document ?', message: 'Ses passages seront retirés des prochaines recherches.', confirmLabel: 'Supprimer', destructive: true })) return;
    const result = await mutation.run(() => knowledgeApi.remove(id));
    if (result.ok) router.replace('/knowledge');
  };
  const reindex = async () => {
    const result = await mutation.run(() => knowledgeApi.reindex(id));
    if (result.ok) request.setData(result.data);
  };
  return (
    <Screen scroll header={<AppHeader title={isNew ? 'Ajouter une connaissance' : 'Document'} showBack />}>
      {request.loading ? <SkeletonList count={3} /> : request.error ? <ErrorState message={request.error} onRetry={request.reload} /> : (
        <>
          <TextField label="Titre" value={title} onChangeText={setTitle} maxLength={200} editable={!mutation.pending} />
          <SelectField label="Type de connaissance" value={documentType} options={types} onChange={setDocumentType} disabled={mutation.pending} />
          <Toggle label="Document interne" description="Consultable ici, exclu des réponses publiques proposées par l’IA." value={internal} onValueChange={setInternal} disabled={mutation.pending} />
          {isNew ? <Button label="Importer PDF, DOCX, TXT ou CSV" variant="secondary" onPress={pickFile} disabled={mutation.pending} /> : null}
          {file ? <><Text>{file.name} · maximum 10 Mo</Text><Button label="Utiliser un texte manuel" variant="ghost" onPress={() => setFile(null)} /></> : (
            <TextField label="Contenu" value={content} onChangeText={setContent} multiline maxLength={250000} editable={!mutation.pending} placeholder="Question : quels sont vos horaires ? Réponse : …" />
          )}
          <Callout>Ajoutez des informations à jour et autorisées à être utilisées pour cette marque. Les PDF numérisés doivent contenir une couche de texte.</Callout>
          {formError ? <Callout tone="warning">{formError}</Callout> : null}
          {request.data?.error ? <Callout tone="warning">{request.data.error}</Callout> : null}
          {request.data ? <Text>{request.data.chunkCount} passages · {request.data.status === 'READY' ? 'Indexé' : 'À indexer'}</Text> : null}
          <Button label={mutation.pending ? 'Traitement en cours…' : 'Enregistrer et indexer'} onPress={save} loading={mutation.pending} disabled={!brand} />
          {!isNew ? <><Button label="Réindexer" variant="secondary" onPress={reindex} disabled={mutation.pending} /><Button label="Supprimer" variant="danger" onPress={remove} disabled={mutation.pending} /></> : null}
          {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
        </>
      )}
    </Screen>
  );
}
