import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  Button,
  Callout,
  Card,
  DetailRow,
  Divider,
  Screen,
  Text,
  useFeedback,
} from '@/components/ui';
import { palette, spacing } from '@/theme';

const UPDATED_AT = '12/06/2026';

const COLLECTED = [
  { label: 'Compte (nom, email)', retention: 'Durée du compte' },
  { label: 'Publications & médias', retention: '24 mois' },
  { label: 'Commentaires importés', retention: '12 mois' },
  { label: 'Analyses et réponses IA', retention: '12 mois' },
  { label: 'Journaux techniques', retention: '12 mois (anonymisés)' },
];

const SECTIONS = [
  {
    title: 'Finalités',
    body: 'Publier sur les réseaux connectés, synchroniser les commentaires, produire des propositions de réponses et calculer les statistiques d’engagement.',
  },
  {
    title: 'Base de traitement',
    body: 'L’exécution du contrat de service pour les données de compte et de publication ; votre consentement pour l’accès aux comptes sociaux, révocable à tout moment.',
  },
  {
    title: 'Sécurité',
    body: 'Les mots de passe sont hachés et ne sont jamais stockés en clair. Les jetons d’accès aux réseaux sociaux restent côté serveur ; le téléphone ne conserve que le jeton de session, dans le coffre sécurisé du système.',
  },
  {
    title: 'Vos droits',
    body: 'Accès, rectification, export et suppression des données depuis les paramètres du compte. La suppression du compte révoque les accès sociaux et annule les publications planifiées.',
  },
];

/**
 * ÉCRAN 30 - Politique de confidentialité (`/legal/privacy`)
 */
export default function PrivacyScreen() {
  const router = useRouter();
  const { toast } = useFeedback();

  return (
    <Screen
      scroll
      header={<AppHeader title="Confidentialité" showBack />}
      footer={<Button label="J’ai compris" onPress={() => router.back()} block />}
    >
      <Text variant="micro" color={palette.inkDisabled}>
        Mise à jour : {UPDATED_AT}
      </Text>

      <Card style={styles.card}>
        <Text variant="eyebrow">Données collectées et conservation</Text>
        {COLLECTED.map((entry, index) => (
          <View key={entry.label}>
            {index > 0 ? <Divider style={styles.divider} /> : null}
            <DetailRow label={entry.label} value={entry.retention} />
          </View>
        ))}
      </Card>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text variant="body" weight="bold">
            {section.title}
          </Text>
          <Text variant="footnote" color={palette.inkMuted} style={styles.body}>
            {section.body}
          </Text>
        </View>
      ))}

      <Button
        label="Exporter mes données"
        variant="secondary"
        icon="external"
        onPress={() => toast('Votre export vous sera envoyé par email sous 48 h.', 'success')}
        block
      />

      <Callout tone="neutral" icon="info">
        Contact : privacy@hootly.app
      </Callout>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xl },
  divider: { marginVertical: spacing.xl },
  section: { gap: spacing.sm },
  body: { lineHeight: 21 },
});
