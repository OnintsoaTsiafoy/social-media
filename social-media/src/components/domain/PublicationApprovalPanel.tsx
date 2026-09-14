import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Badge, Button, Callout, Card, DetailRow, ErrorState, SelectField, Text, TextField, useFeedback } from '@/components/ui';
import { approvalsApi, type ApprovalAction } from '@/data/api';
import { useAsync, useMutation } from '@/hooks/useAsync';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { spacing } from '@/theme';
import type { ApprovalMember, ApprovalStatus, Publication } from '@/types';

export const approvalLabels: Record<ApprovalStatus, string> = {
  pending: 'En attente d’approbation', approved: 'Publication approuvée', rejected: 'Publication refusée',
  changes_requested: 'Modifications demandées', cancelled: 'Demande annulée',
};

export function PublicationApprovalPanel({ publication, onChange, onBusyChange }: {
  publication: Publication; onChange: (publication: Publication) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { user, refreshUnreadCount } = useSession();
  const { toast } = useFeedback();
  const mutation = useMutation();
  const [reviewerId, setReviewerId] = useState('');
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string>();
  const members = useAsync(() => approvalsApi.members(publication.brandId), [publication.brandId]);
  const role = members.data?.find((member) => member.id === user?.id)?.role;
  const canReview = role === 'admin' || role === 'owner';
  const canWrite = canReview || role === 'community_manager';
  const approval = publication.approval;
  const pending = publication.status === 'pending_approval' && approval?.status === 'pending';
  const canCancel = canWrite && (canReview || approval?.requestedBy === user?.id || publication.authorId === user?.id);
  const reviewers = (members.data ?? []).filter((member: ApprovalMember) => ['admin', 'owner'].includes(member.role));

  const act = async (action: ApprovalAction | 'request-approval') => {
    if (['reject', 'request-changes'].includes(action) && !comment.trim()) {
      setCommentError('Expliquez le refus ou les modifications demandées.');
      return;
    }
    setCommentError(undefined);
    onBusyChange?.(true);
    const result = await mutation.run(() => action === 'request-approval'
      ? approvalsApi.request(publication.id, { reviewerId: reviewerId || undefined, comment: comment.trim() || undefined })
      : approvalsApi.decide(publication.id, action, approval!.id, comment.trim() || undefined));
    onBusyChange?.(false);
    if (!result.ok) return;
    setComment('');
    onChange(result.data);
    void refreshUnreadCount();
    toast(action === 'request-approval' ? 'Demande envoyée.' : 'Décision enregistrée.', 'success');
  };

  return (
    <Card style={styles.panel}>
      <Text variant="eyebrow">Approbation</Text>
      {approval ? <>
        <Badge label={approvalLabels[approval.status]} tone={approval.status === 'approved' ? 'success' : approval.status === 'pending' ? 'warning' : 'neutral'} />
        <DetailRow label={approval.status === 'pending' ? 'Demandée à' : 'Responsable'} value={approval.reviewerName ?? 'Responsables de la marque'} />
        <DetailRow label="Demandée par" value={approval.requesterName} />
        <DetailRow label="Date de demande" value={formatDateTime(approval.requestedAt)} />
        {approval.reviewedAt ? <DetailRow label="Date de décision" value={formatDateTime(approval.reviewedAt)} /> : null}
        {approval.requestComment ? <Text variant="body">Demande : {approval.requestComment}</Text> : null}
        {approval.comment ? <Callout tone={approval.status === 'approved' ? 'success' : 'warning'}>{approval.comment}</Callout> : null}
        {approval.status === 'approved' && !publication.approvalValid ? <Callout tone="warning">Le contenu a été modifié. Une nouvelle approbation est nécessaire.</Callout> : null}
      </> : <Text variant="body">Faites valider cette publication par un responsable avant de la publier ou de la planifier.</Text>}

      {members.error ? <ErrorState compact message={members.error} onRetry={members.reload} /> : null}
      {publication.status === 'draft' && canWrite ? <>
        <SelectField label="Approbateur" value={reviewerId} onChange={setReviewerId} disabled={mutation.pending}
          options={[{ value: '', label: 'Tous les responsables' }, ...reviewers.map((member) => ({ value: member.id, label: member.displayName }))]} />
        <TextField label="Commentaire facultatif" value={comment} onChangeText={setComment} multiline maxLength={2000} editable={!mutation.pending} />
        <Button label="Demander une approbation" onPress={() => act('request-approval')} loading={mutation.pending} disabled={!reviewers.length} />
      </> : null}
      {pending && canReview ? <>
        <TextField label="Commentaire (obligatoire pour un refus ou une modification)" value={comment}
          onChangeText={(text) => { setComment(text); setCommentError(undefined); }} error={commentError} multiline maxLength={2000} editable={!mutation.pending} />
        <Button label="Approuver" onPress={() => act('approve')} disabled={mutation.pending} />
        <Button label="Demander modification" variant="secondary" onPress={() => act('request-changes')} disabled={mutation.pending} />
        <Button label="Refuser" variant="danger" onPress={() => act('reject')} disabled={mutation.pending} />
      </> : null}
      {pending && canCancel ? <Button label="Annuler la demande" variant="secondary" onPress={() => act('cancel-approval')} disabled={mutation.pending} /> : null}
      {publication.status === 'rejected' && canWrite ? <Button label="Modifier et renvoyer" onPress={() => router.push(`/publications/${publication.id}/edit`)} /> : null}
      <View><Button label="Historique des actions" variant="secondary" size="sm" onPress={() => router.push(`/publications/${publication.id}/approval-history`)} /></View>
      {mutation.error ? <Callout tone="danger">{mutation.error}</Callout> : null}
    </Card>
  );
}

const styles = StyleSheet.create({ panel: { gap: spacing.lg } });
