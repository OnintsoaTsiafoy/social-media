# Hootly - console d'administration web

Application web (Vite / React / TypeScript) qui implémente la maquette
`Community Admin Dashboard.dc.html` de Claude Design : six écrans de supervision et
d'administration pour les administrateurs de la plateforme.

| Écran | Route | Contenu |
|---|---|---|
| Overview | `#/overview` | Flux live (orbite FB/IG), KPI, volume de commentaires et sentiment, santé système, escalades, classement des managers |
| AI supervision | `#/supervision` | File de validation des brouillons IA (approuver, éditer, rejeter, escalader), seuil d'autonomie, règles d'escalade, performance du modèle |
| Analytics | `#/analytics` | Courbe de tendance (métrique, période, sentiment, page), performance par page, pics d'activité |
| Users & roles | `#/users` | Membres filtrables, tiroir rôle et permissions |
| Pages | `#/pages` | Pages connectées, réponse automatique par page, état des jetons |
| Configuration | `#/configuration` | Mots-clés de modération, niveaux de service, journal d'audit |

## Démarrage

```bash
npm install          # depuis admin-web/ (Node >= 20.19)
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest (jsdom)
npm run build        # typecheck puis build de production dans dist/
```

Depuis la racine du dépôt, `./scripts/test.ps1` exécute aussi le typecheck, le lint et les tests
de ce paquet. Les dépendances de test sont volontairement épinglées à des versions compatibles
Node 20 (Vitest 3, jsdom 26, Vite 7) : les versions plus récentes exigent Node 22.

## État actuel : données fictives

Contrairement à l'application mobile, **cette console n'est pas encore branchée à l'API Express** :
l'API n'expose pas (encore) de rôle administrateur de plateforme, ni les agrégats affichés ici
(utilisateurs et rôles globaux, santé système, journal d'audit…). Tout provient de jeux de données
typés dans [src/data/](src/data/), un fichier par écran.

Pour brancher un écran sur le backend, remplacer la source de données correspondante dans
[src/state/](src/state/) (les hooks exposent déjà les actions - `approve`, `save`, `suspend`… - que
l'écran appelle) sans toucher aux composants. Comme l'app mobile, la console ne devra parler
qu'à l'API Express, jamais directement à PostgreSQL, Meta ou au service IA.

## Organisation

```
src/
  App.tsx              coque : barre latérale, en-tête, écran courant, tiroir, toast
  config.ts            nom du produit, administrateur connecté
  types.ts             types partagés (ScreenId, Tone, NetFilter…)
  data/                jeux de données fictifs, un fichier par écran
  lib/                 fonctions pures (formats, calculs de graphiques) et hooks d'animation
  state/               état conservé entre les écrans (AdminContext + un hook par domaine)
  components/          Toggle, Network, icônes, coque (Sidebar, Topbar, UserDrawer, Toast)
  screens/<écran>/     composants de l'écran + sa feuille de style
  styles/              tokens (palette de la maquette), base, primitives, coque
```

- **Palette** : `src/styles/tokens.css` reprend le fichier « code couleur » de la maquette. Les
  pastilles prennent leurs couleurs d'un attribut `data-tone` (`success`, `warning`, `danger`,
  `info`, `fb`, `ig`…) plutôt que de valeurs en dur.
- **État** : la maquette garde tout dans un seul composant, donc filtres, file de validation et
  modifications survivent à la navigation. `AdminProvider` conserve ce comportement.
- **Routage** : par hash (`#/users`), sans dépendance : l'URL survit à un rechargement et le
  bouton « précédent » fonctionne. Changer d'écran affiche brièvement le squelette de chargement.

## Écarts assumés par rapport à la maquette

- **Animations d'entrée** : `animation-fill-mode: backwards` au lieu de `both`. Avec `both`, le
  `transform: none` final reste figé et annule tous les effets `:hover` de lévitation.
- **Infobulles et toast** centrés avec la propriété `translate` (et non `transform`), que
  l'animation d'entrée écraserait et décentrerait.
- **Dates dynamiques** : l'en-tête de l'overview et les 14 jours du graphique suivent l'horloge ;
  « Peak day » est calculé à partir de la série affichée.
- **Permissions et rôle par membre** : le tiroir travaille sur un brouillon, appliqué à « Save
  changes » ; « Suspend » déplace le membre dans le filtre *Suspended*. La maquette partageait un
  seul jeu de permissions entre tous les membres.
- **Accessibilité** : vrais `<button>` et liens (clavier), interrupteurs `role="switch"`, anneau de
  focus visible, `prefers-reduced-motion` respecté, toast annoncé aux lecteurs d'écran.
- Le filtre de réseau de l'overview filtre aussi le tableau d'Analytics (comme dans la
  maquette) ; un bouton « Clear » rend ce couplage visible.
- Les textes de l'interface restent en anglais, comme dans la maquette (l'app mobile est en
  français).

Non implémenté car absent de la maquette ou sans effet dans celle-ci : la recherche de l'en-tête
(⌘K), le menu du profil et le menu « ⋯ » des lignes de la table des membres.

La mise en page cible un poste de bureau (≥ 1024 px) : la barre latérale est fixe, comme dans la
maquette.
