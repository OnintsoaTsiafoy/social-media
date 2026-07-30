# Hootly - application mobile d’assistance au Community Manager

Application Expo (SDK 55) / React Native / TypeScript couvrant les **31 écrans** du
document `ECRANS_Application_Community_Manager.md`, avec la direction visuelle validée
dans `Ecrans App CM.dc.html` (cartes blanches, accent lime `#C4F04A`, texte nuit `#0F172A`).

## Démarrage

```bash
npm install
npm start          # puis « a » (Android), « i » (iOS) ou « w » (web)
npm run typecheck  # tsc --noEmit
npm run lint
```

> **Node ≥ 20.19.4** est requis par React Native 0.83. Les versions antérieures
> (dont 20.19.0) déclenchent un avertissement `EBADENGINE` au `npm install`.

### Compte de démonstration

Il n’y a pas encore de backend : `src/data/api.ts` simule les appels réseau avec
latence et erreurs.

- Email : `lea@studio-vega.fr` - n’importe quel mot de passe
- `wrongpassword` → identifiants incorrects
- `bloque@studio-vega.fr` → compte désactivé
- `deja@studio-vega.fr` (inscription) → email déjà utilisé

Le tableau de bord expose un bloc « Démo des états » permettant de déclencher une
erreur serveur ou de basculer hors connexion, afin de visualiser tous les états
demandés par la spécification.

## Structure

```
app/                     Routes (expo-router, file-based)
├── index.tsx            01 Splash - valide la session puis redirige
├── (auth)/              02 Inscription · 03 Connexion · 04 Mot de passe oublié · 05 Réinitialisation
├── (tabs)/              06 Accueil · 07 Publications · 17 Commentaires · 22 Analytics · 26 Plus
├── publications/        08 Nouvelle · 09 Modification · 12 Planification · 14 Détail
├── comments/[id]/       18 Détail · 19 Éditeur de réponse IA · 20 Historique
├── analytics/           23 Analytics d’une publication
├── settings/            15 Comptes sociaux · 25 Marque & ton IA · 27 Notifications
│                        28 Sécurité · 31 Suppression du compte
├── legal/               29 Conditions · 30 Confidentialité
├── oauth/callback.tsx   16 Retour OAuth
├── calendar.tsx         13 Calendrier éditorial
├── notifications.tsx    21 Centre de notifications
├── profile.tsx          24 Profil utilisateur
├── media-picker.tsx     10 Sélection d’un média (panneau inférieur)
└── hashtags.tsx         11 Génération de hashtags (panneau inférieur)

src/
├── theme/               Tokens (couleurs, espacements, rayons, typographie) + helpers responsive
├── components/ui/       Composants transverses (Screen, AppHeader, Button, TextField, Badge…)
├── components/domain/   Cartes métier (PublicationCard, CommentCard, TabBar, CalendarMonth…)
├── data/                api.ts (façade réseau) · fixtures.ts (jeu de données) · options.ts
├── hooks/               useAsync · useMutation · usePaginatedList
├── store/               SessionProvider (session + marque active) · ComposerProvider
├── lib/                 validation · format · secureStorage
└── types/               Modèle de domaine
```

## Conventions

- **Un seul primitif de texte** (`components/ui/Text`) : il relie chaque graisse à la
  bonne famille Plus Jakarta Sans et plafonne la mise à l’échelle système par variante.
- **Toute lecture passe par `useAsync` / `usePaginatedList`**, qui exposent les états
  chargement / erreur / vide exigés par la spécification.
- **Toute écriture passe par `useMutation`**, qui garantit un seul appel en vol : un
  double appui ne peut pas publier ou envoyer deux fois.
- **Aucun message technique à l’écran** : `toUserMessage()` traduit les codes d’erreur
  API en texte actionnable.
- **Métriques manquantes** affichées « Non disponible », jamais `0`.
- **Aucun token affiché ni stocké en clair** : le JWT de session va dans
  `expo-secure-store` (`sessionStorage` sur web), les tokens sociaux restent côté serveur.
- **Validation humaine obligatoire** avant l’envoi d’une réponse IA ; la proposition
  d’origine est conservée et chaque édition crée une version.

## Responsive

`src/theme/responsive.ts` centralise les décisions dépendant de la taille d’écran :
gouttières (16 / 20 / 24 dp), largeur maximale de la colonne de lecture (640 dp sur
tablette) et `autoGridCell()` pour les grilles qui passent de 2 à 4 colonnes sans
point de rupture explicite. Le reste du layout est en flex, avec `SafeAreaView`,
`KeyboardAvoidingView` et cibles tactiles ≥ 44 dp.

## Reste à faire

- Brancher `src/data/api.ts` sur le backend réel (les signatures sont le contrat).
- WebSocket temps réel pour le compteur de notifications (l’UI est prête).
- Flux OAuth réel via `expo-web-browser` + deep link `hootly://oauth/callback`.
- Notifications push (`expo-notifications`) et sélection d’avatar.
