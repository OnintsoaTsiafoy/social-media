import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, Button, Screen, Text } from '@/components/ui';
import { palette, spacing } from '@/theme';

const VERSION = '1.2';
const UPDATED_AT = '12/06/2026';

const SECTIONS = [
  {
    title: '1. Objet',
    body: 'L’application permet de planifier des publications, de centraliser les commentaires des réseaux sociaux connectés et d’obtenir des propositions de réponses générées par intelligence artificielle.',
  },
  {
    title: '2. Usage autorisé',
    body: 'L’utilisateur s’engage à publier uniquement des contenus dont il détient les droits et à respecter les règles des plateformes connectées ainsi que la législation applicable.',
  },
  {
    title: '3. Responsabilités',
    body: 'L’utilisateur reste responsable des contenus publiés depuis son compte, y compris ceux issus d’une proposition générée par l’intelligence artificielle et validés par lui.',
  },
  {
    title: '4. Comptes sociaux',
    body: 'Les accès sont accordés par l’utilisateur via OAuth et peuvent être révoqués à tout moment depuis les paramètres. Les jetons d’accès sont conservés côté serveur et ne sont jamais affichés.',
  },
  {
    title: '5. Intelligence artificielle',
    body: 'Les réponses proposées sont indicatives et peuvent comporter des erreurs. Toute publication reste soumise à une validation humaine explicite.',
  },
  {
    title: '6. Interdictions',
    body: 'Sont notamment interdits : l’automatisation de réponses sans validation, la publication de contenus illicites, l’usurpation d’identité et le contournement des limites des plateformes.',
  },
  {
    title: '7. Disponibilité',
    body: 'Le service est fourni sans garantie de disponibilité continue. Des interruptions peuvent survenir pour maintenance ou en raison d’une indisponibilité des plateformes tierces.',
  },
  {
    title: '8. Limitation de responsabilité',
    body: 'L’indisponibilité d’une plateforme tierce, la modification de ses interfaces ou le refus d’une permission ne peuvent être imputés à l’éditeur de l’application.',
  },
];

/**
 * ÉCRAN 29 - Conditions d’utilisation (`/legal/terms`)
 *
 * Reached either from the settings (read-only) or from registration, where the
 * `accept` param turns the footer into a consent action.
 */
export default function TermsScreen() {
  const router = useRouter();

  return (
    <Screen
      scroll
      header={<AppHeader title="Conditions d’utilisation" showBack />}
      footer={<Button label="J’ai compris" onPress={() => router.back()} block />}
    >
      <Text variant="micro" color={palette.inkDisabled}>
        Mise à jour : {UPDATED_AT} · version {VERSION}
      </Text>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  body: { lineHeight: 21 },
});
