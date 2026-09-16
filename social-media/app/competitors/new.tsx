import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { competitorStatusMeta } from '@/components/domain/CompetitorCard';
import {
  AppHeader,
  Badge,
  Button,
  Callout,
  Card,
  DetailRow,
  Screen,
  SegmentedControl,
  Text,
  TextField,
  useFeedback,
} from '@/components/ui';
import { competitorsApi } from '@/data/api';
import { useMutation } from '@/hooks/useAsync';
import { formatCompactNumber } from '@/lib/format';
import { useSession } from '@/store/SessionProvider';
import { palette, spacing } from '@/theme';
import type { SocialNetwork } from '@/types';
import type { CompetitorVerification } from '@/types/competitors';

/**
 * Ajouter un concurrent (`/competitors/new`).
 *
 * Deux temps volontairement séparés, comme le décrit la section 2 du TODO :
 * on vérifie d'abord auprès de Meta, on ajoute ensuite. Enchaîner les deux
 * masquerait ce que Meta autorise réellement pour ce compte — or c'est
 * précisément ce que l'utilisateur doit voir avant de s'engager.
 */
export default function NewCompetitorScreen() {
  const router = useRouter();
  const { brand } = useSession();
  const { toast } = useFeedback();

  const [platform, setPlatform] = useState<SocialNetwork>('instagram');
  const [handle, setHandle] = useState('');
  const [verification, setVerification] = useState<CompetitorVerification | null>(null);

  const verifying = useMutation();
  const adding = useMutation();

  function onChangeHandle(value: string) {
    setHandle(value);
    // Une vérification ne vaut que pour la valeur saisie au moment où elle a
    // été faite : la conserver après une modification laisserait ajouter un
    // compte sur la foi d'un contrôle fait sur un autre.
    setVerification(null);
  }

  function onChangePlatform(value: SocialNetwork) {
    setPlatform(value);
    setVerification(null);
  }

  async function onVerify() {
    if (!brand) return;
    const result = await verifying.run(() => competitorsApi.verify(brand.id, platform, handle.trim()));
    if (result.ok && result.data) setVerification(result.data);
  }

  async function onAdd() {
    if (!brand) return;
    const result = await adding.run(() => competitorsApi.create(brand.id, platform, handle.trim()));
    if (result.ok) {
      toast('Concurrent ajouté. La première collecte est en cours.');
      router.replace(`/competitors/${result.data.id}`);
    } else if (result.error) {
      toast(result.error, 'error');
    }
  }

  const status = verification ? competitorStatusMeta[verification.status] : null;
  const canAdd = Boolean(brand) && handle.trim().length > 0 && verification?.status !== 'unavailable';

  return (
    <Screen
      scroll
      header={<AppHeader title="Ajouter un concurrent" showBack />}
      footer={
        <View style={styles.footer}>
          <Button
            label="Vérifier"
            variant="secondary"
            loading={verifying.pending}
            disabled={handle.trim().length === 0}
            onPress={onVerify}
            style={styles.footerButton}
          />
          <Button
            label="Ajouter"
            loading={adding.pending}
            disabled={!canAdd || verification?.alreadyAdded}
            onPress={onAdd}
            style={styles.footerButton}
          />
        </View>
      }
    >
      <SegmentedControl
        label="Réseau"
        value={platform}
        options={[
          { value: 'facebook', label: 'Facebook' },
          { value: 'instagram', label: 'Instagram' },
        ]}
        onChange={onChangePlatform}
      />

      <TextField
        label={platform === 'facebook' ? 'URL de la Page ou nom de Page' : 'URL du profil ou nom d’utilisateur'}
        value={handle}
        onChangeText={onChangeHandle}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={platform === 'facebook' ? 'facebook.com/ma-page-concurrente' : '@competitor_brand'}
        hint={
          platform === 'facebook'
            ? 'La lecture d’une Page que vous n’administrez pas dépend d’une autorisation Meta (Page Public Content Access).'
            : 'Seuls les comptes professionnels (entreprise ou créateur) peuvent être analysés.'
        }
        error={verifying.error}
      />

      {verification && status ? (
        <Card>
          <View style={styles.result}>
            <View style={styles.resultHeader}>
              <Text weight="bold">{verification.name ?? verification.username}</Text>
              <Badge label={status.label} tone={status.tone} />
            </View>

            {verification.status === 'active' ? (
              <>
                <DetailRow label="Nom d’utilisateur" value={`@${verification.username}`} />
                <DetailRow label="Type" value={verification.accountType ?? 'Non communiqué'} />
                <DetailRow
                  label="Abonnés"
                  value={
                    verification.followersCount === null
                      ? 'Non disponible'
                      : formatCompactNumber(verification.followersCount)
                  }
                />
                <DetailRow
                  label="Publications"
                  value={verification.postsCount === null ? 'Non disponible' : String(verification.postsCount)}
                />
              </>
            ) : (
              <Text variant="footnote" color={palette.inkFaint}>
                {verification.reason ?? status.hint}
              </Text>
            )}

            {verification.unavailableFields.length > 0 ? (
              <Callout tone="neutral" title="Données non disponibles via Meta">
                {verification.unavailableFields.map(fieldLabel).join(', ')}. Ces métriques resteront affichées comme
                « Non disponible », jamais comme 0.
              </Callout>
            ) : null}

            {verification.alreadyAdded ? (
              <Callout tone="warning" title="Déjà suivi">
                Ce concurrent figure déjà dans la liste de cette marque.
              </Callout>
            ) : null}

            {verification.status === 'permission_required' ? (
              <Callout tone="warning" title="Autorisation Meta requise">
                Le compte existe, mais l’application n’a pas encore l’autorisation de le lire. Vous pouvez l’ajouter dès
                maintenant : la collecte démarrera automatiquement une fois l’autorisation obtenue.
              </Callout>
            ) : null}
          </View>
        </Card>
      ) : null}

      <Callout tone="neutral" title="Ce qui est collecté">
        Uniquement des informations publiques, via les API officielles Meta : aucune page n’est aspirée, aucun contrôle
        d’accès n’est contourné. La portée, les impressions et les données d’audience d’un concurrent ne sont jamais
        accessibles.
      </Callout>
    </Screen>
  );
}

const FIELD_LABELS: Record<string, string> = {
  followersCount: 'abonnés',
  postsCount: 'nombre de publications',
  avatarUrl: 'photo de profil',
  profileUrl: 'lien du profil',
  name: 'nom affiché',
  username: 'nom d’utilisateur',
  shares: 'partages',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: spacing.md },
  footerButton: { flex: 1 },
  result: { gap: spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
});
