# Hootly - application mobile d’assistance au Community Manager

Application Expo (SDK 55) / React Native / TypeScript couvrant les écrans du
document `ECRANS_Application_Community_Manager.md` (31 à l’origine, **30 aujourd’hui** : l’écran 16
« Retour OAuth » a été retiré, voir plus bas), avec la direction visuelle validée
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

L'authentification, le profil, les marques, les publications, les médias, la
planification et le calendrier utilisent l'API Express. Les autres domaines de
`src/data/api.ts` (commentaires, comptes sociaux, notifications, tableau de bord,
analytics, hashtags) conservent temporairement leurs simulations avec latence et
erreurs.

- Après `./scripts/seed.ps1` lancé depuis la racine : `lea@studio-vega.fr` / `ChangeMe123!`
- L’inscription crée un utilisateur réel ; l’ancien scénario de démonstration n’est plus utilisé.

Avant de lancer Expo, copiez `.env.example` vers `.env`. Sur l’émulateur Android, utilisez
`EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`; sur un téléphone physique, remplacez `localhost`
par l’adresse IP locale de la machine qui exécute Docker.

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
├── settings/            15 Comptes sociaux (lecture, synchro, déconnexion) · 25 Marque & ton IA
│                        27 Notifications · 28 Sécurité · 31 Suppression du compte
├── legal/               29 Conditions · 30 Confidentialité
├── calendar.tsx         13 Calendrier éditorial
├── notifications.tsx    21 Centre de notifications
├── profile.tsx          24 Profil utilisateur
├── media-picker.tsx     10 Sélection d’un média (panneau inférieur)
└── hashtags.tsx         11 Génération de hashtags (panneau inférieur)

src/
├── theme/               Tokens (couleurs, espacements, rayons, typographie) + helpers responsive
├── components/ui/       Composants transverses (Screen, AppHeader, Button, TextField, Badge…)
├── components/domain/   Cartes métier (PublicationCard, CommentCard, TabBar, CalendarMonth…)
├── data/                api.ts (appels réels + façade résiduelle) · fixtures.ts · options.ts
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

## Connexion des comptes Facebook / Instagram

L’application **ne connecte ni ne reconnecte** de compte : un administrateur de la plateforme lie une
page à un utilisateur et à sa marque depuis la console web (`admin-web/`, écran Pages). L’écran 15 liste
les comptes, les revalide auprès de Meta et permet de les déconnecter ; un compte expiré affiche qu’un
administrateur doit le reconnecter. `POST /social-accounts/:provider/connect` répond `403 forbidden`, et
l’écran 16 (`/oauth/callback`) n’existe plus. Voir [docs/ADMIN_CONSOLE.md](../docs/ADMIN_CONSOLE.md#6-connecter-une-page-à-un-compte-utilisateur).
Les paquets `expo-web-browser` et `expo-linking` ne servent plus à cet usage (`expo-linking` reste requis par `expo-router`).

## Reste à faire

- Brancher les domaines restants de `src/data/api.ts` sur le backend réel (les signatures sont le contrat).
- WebSocket temps réel pour le compteur de notifications (l’UI est prête).
- Notifications push (`expo-notifications`) et sélection d’avatar.
