# Hootly — console d'administration web

Application web (Vite / React / TypeScript) pour les **administrateurs de la plateforme** : six écrans de supervision et d'administration, alimentés par l'API Express (`/api/v1/admin`). Interface en **français par défaut**, anglais disponible. La maquette d'origine est `Community Admin Dashboard.dc.html` (Claude Design).

Le détail de l'API, la définition de chaque chiffre et les choix de périmètre sont dans [docs/ADMIN_CONSOLE.md](../docs/ADMIN_CONSOLE.md).

| Écran | Route | Contenu (données réelles) |
|---|---|---|
| Vue d'ensemble | `#/overview` | Flux en direct, KPI, volume et sentiment sur 14 jours, santé du système, escalades ouvertes (clôturables), classement des managers, export CSV |
| Supervision IA | `#/supervision` | File des brouillons IA à relire (approuver et envoyer, modifier, rejeter avec motif, escalader), seuil d'autonomie, règles d'escalade, performance du modèle |
| Analytique | `#/analytics` | Courbe (engagement, temps de réponse, sentiment, performance IA) avec période précédente, performance par page, pic d'activité |
| Utilisateurs et rôles | `#/users` | Comptes filtrables et paginés, tiroir : rôles par marque, accès plateforme, suspension |
| Pages | `#/pages` | Pages connectées de toutes les marques, jeton, arriéré, équipe, réponse automatique par page |
| Configuration | `#/configuration` | Mots-clés de modération, niveaux de service, journal d'audit |

## Démarrage

```bash
npm install          # depuis admin-web/ (Node >= 20.19)
npm run dev          # http://localhost:5173, proxy /api → http://localhost:3000
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest (jsdom), API simulée
npm run build        # typecheck puis build de production dans dist/
```

Prérequis : la pile Compose démarrée et le seed appliqué (`./scripts/start.ps1`, `./scripts/seed.ps1`), puis connexion avec `admin@hootly.app` / `ChangeMe123!` (compte de démonstration, seul rôle `PLATFORM_ADMIN` du seed).

Variables (toutes facultatives) :

| Variable | Rôle |
|---|---|
| `VITE_DEV_API_TARGET` | Cible du proxy de développement (défaut `http://localhost:3000`) |
| `VITE_API_BASE_URL` | URL de l'API quand la console n'est pas servie derrière le même hôte (défaut `/api/v1`) ; l'API doit alors autoriser l'origine via `CORS_ALLOWED_ORIGINS` |

Depuis la racine, `./scripts/test.ps1` exécute aussi le typecheck, le lint et les tests de ce paquet. Les dépendances de test sont épinglées à des versions compatibles Node 20 (Vitest 3, jsdom 26, Vite 7) : les versions plus récentes exigent Node 22.

## Organisation

```
src/
  App.tsx              coque : connexion, barre latérale, en-tête, écran courant, toast
  config.ts            nom du produit
  types.ts             ScreenId, Tone, NetFilter
  api/                 transport (enveloppe, ApiError), session (jetons), client (rafraîchissement),
                       endpoints (une fonction par route), errors (code → message traduit), types (DTO)
  i18n/                catalogues fr/en typés, formats (nombres, durées, dates), provider
  domain/              règles d'affichage : tons, seuils, phrases (santé, jeton, seuil, audit)
  state/               contexte partagé + un hook de données par écran (useOverview, useSupervision…)
  lib/                 fonctions pures (graphique, écarts, export CSV) et hooks d'animation
  components/          Toggle, Network, LocaleSwitch, ErrorState, coque (Sidebar, Topbar, Toast…)
  screens/<écran>/     composants de l'écran + sa feuille de style
  styles/              tokens (palette de la maquette), base, primitives, coque
  test/                fixtures typées et API simulée (utilisées par les seuls tests)
```

- **Données.** Chaque écran charge les siennes à l'ouverture, via `useResource` (annulation des requêtes périmées, données conservées pendant un rechargement, rafraîchissement silencieux). Seuls les compteurs de la coque tournent en permanence. Squelette au premier chargement, encart d'erreur avec « Réessayer » ensuite ; les erreurs sont traduites, jamais techniques.
- **Écritures.** Immédiates à l'écran puis confirmées par le serveur (annulées si refus). Les réglages rapprochés (curseur, boutons +/−) sont regroupés en un seul enregistrement, envoyé aussi si l'on quitte l'écran.
- **Mesure indisponible.** `null` côté API → « Non disponible » à l'écran, jamais `0`.
- **Session.** Jeton d'accès en mémoire, jeton de rafraîchissement dans `sessionStorage`. Une session perdue ramène à la connexion.
- **Palette.** `src/styles/tokens.css` reprend le fichier « code couleur » de la maquette. Les pastilles prennent leurs couleurs d'un attribut `data-tone` (`success`, `warning`, `danger`, `info`, `fb`, `ig`…).
- **Routage.** Par hash (`#/users`), sans dépendance.

## Internationalisation

Français par défaut, anglais en second ; choix mémorisé dans le navigateur. Les catalogues sont typés : `en.ts` doit avoir exactement les clés de `fr.ts`, sinon `tsc` échoue. Pluriels `x_one` / `x_other`, typographie française (insécables), formats de nombres, de durées et de dates suivant la langue. Détails et marche à suivre pour ajouter une langue : [docs/ADMIN_CONSOLE.md](../docs/ADMIN_CONSOLE.md#6-internationalisation).

## Tests

- Unitaires : formats, i18n (parité des catalogues), graphique, écarts, export CSV, règles d'affichage, couche API (rafraîchissement unique, erreurs).
- Écrans : `src/App.test.tsx` rend l'application entière contre une API simulée (`src/test/mockApi.ts`) — connexion, langue, chaque écran et chacune de ses actions.
- Bout en bout : `src/e2e.test.tsx`, ignoré par défaut, contre la vraie API :
  `ADMIN_E2E=1 VITE_API_BASE_URL=http://localhost:3000/api/v1 npm test -- e2e`. Ses seules écritures sont réversibles.

## Écarts assumés par rapport à la maquette

- **Animations d'entrée** : `animation-fill-mode: backwards` au lieu de `both` (avec `both`, le `transform: none` final annule les effets `:hover`). Les chiffres et courbes s'affichent directement quand le système demande moins d'animations.
- **Infobulles et toast** centrés avec la propriété `translate`, que l'animation d'entrée écraserait.
- **Actions retirées faute d'équivalent serveur** : « Inviter un manager », permissions par membre, statut « Invité », « Connecter une page », quota Graph API. Voir [docs/ADMIN_CONSOLE.md](../docs/ADMIN_CONSOLE.md#5-ce-qui-nexiste-volontairement-pas).
- **Ajouts** : écran de connexion, sélecteur de langue, état de chargement et d'erreur, modification du brouillon avant envoi, clôture d'une escalade, export CSV du rapport, recherche de l'en-tête (utilisateurs, ⌘K / Ctrl+K).
- **Réglages enregistrés mais non appliqués** (mots-clés, seuil d'autonomie, règles, réponse automatique par page) : l'écran l'indique. Rien ne part sans validation humaine.
- **Accessibilité** : vrais `<button>` et liens, interrupteurs `role="switch"`, anneau de focus visible, `prefers-reduced-motion` respecté (CSS et animations JS), toast annoncé aux lecteurs d'écran.

La mise en page cible un poste de bureau (≥ 1024 px) : la barre latérale est fixe, comme dans la maquette.
