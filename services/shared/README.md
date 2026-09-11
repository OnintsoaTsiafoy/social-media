# services/shared

Modules purs importés par l'API Express **et** par le worker.

Contrainte : aucun import de dépendance npm ici. Les deux services copient ce
dossier dans leur image en conservant le chemin `services/shared`, mais leurs
`node_modules` respectifs vivent dans `services/api` et `services/worker` : un
`import` de paquet depuis ce dossier ne serait pas résolu à l'exécution.

| Module | Rôle |
|---|---|
| `publication-status.js` | Statuts, transitions autorisées, statut global déduit des cibles, backoff de retry. |
| `social-provider.js` | Connecteur social simulé du Sprint 04 (`MockSocialProvider`). |
| `media-inspect.js` | Détection du type réel d'une image, dimensions, clés d'objet S3. |
| `jobs.js` | Noms des files pg-boss et clé d'unicité par publication. |
