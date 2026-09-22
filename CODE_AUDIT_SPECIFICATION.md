# Spécification de l’audit technique du projet

Ce document décrit les informations à extraire du dépôt afin de produire un audit technique complet du projet, notamment pour le rapport MBDS. Toute conclusion doit être fondée sur des éléments réellement observables dans le code, la configuration, la documentation ou l’historique Git.

## 1. Vue générale du projet

- Identifier le nom du projet et l’éventuelle description trouvée dans `README`, `package.json`, `pom.xml`, etc.
- Recenser tous les sous-projets et applications présents : mobile, web admin, backend, service Facebook Graph API, service IA, workers, etc.
- Présenter l’arborescence principale du dépôt.
- Expliquer le rôle de chaque dossier important.
- Identifier les langages utilisés.
- Identifier les frameworks utilisés.
- Relever les versions exactes détectées.
- Identifier les gestionnaires de dépendances.
- Fournir le nombre approximatif de fichiers, classes ou modules importants.
- Identifier les points d’entrée de chaque application.
- Recenser les commandes de démarrage et de build disponibles.
- Identifier les environnements présents : local, développement, staging/préproduction et production.
- Déterminer si le projet est un monorepo ou s’il est composé de plusieurs projets indépendants.

## 2. Architecture globale

- Identifier tous les composants du système :
  - application mobile ;
  - application web d’administration ;
  - backend/API principale ;
  - service Facebook/Meta Graph API ;
  - service IA/NLP ;
  - base ou bases de données ;
  - Firebase éventuel ;
  - WebSocket ou autre système temps réel ;
  - workers et tâches asynchrones ;
  - stockage de fichiers ;
  - services externes.
- Pour chaque composant, préciser :
  - sa responsabilité ;
  - les technologies employées ;
  - ses entrées et sorties ;
  - ses dépendances ;
  - son mode de communication avec les autres composants.
- Déterminer les protocoles utilisés :
  - REST ;
  - WebSocket ;
  - HTTP ;
  - OAuth ;
  - Webhooks ;
  - autres protocoles éventuels.
- Produire, si possible, un diagramme d’architecture Mermaid.
- Produire également un diagramme des principaux flux de données.

## 3. Fonctionnalités réellement présentes

- Faire l’inventaire de toutes les fonctionnalités implémentées.
- Pour chaque fonctionnalité, préciser :
  - le nom ;
  - l’objectif ;
  - l’utilisateur concerné ;
  - l’écran éventuel ;
  - l’endpoint utilisé ;
  - les services ou classes impliqués ;
  - les tables ou collections utilisées ;
  - le statut : complet, partiel, prototype ou TODO.
- Rechercher notamment tout ce qui concerne :
  - l’authentification ;
  - l’inscription ;
  - les utilisateurs ;
  - les rôles ;
  - les permissions ;
  - la gestion des pages sociales ;
  - l’association utilisateur ↔ page Facebook ;
  - la récupération des publications ;
  - la récupération des commentaires ;
  - la publication ;
  - les réponses aux commentaires ;
  - les statistiques ;
  - le dashboard ;
  - la recherche et le filtrage ;
  - l’analyse de sentiment ;
  - la génération de réponses ;
  - la supervision IA ;
  - les notifications ;
  - le temps réel ;
  - l’historique ;
  - l’administration ;
  - les analytics.
- Ne pas considérer un écran vide ou un mock comme une fonctionnalité terminée.

## 4. Utilisateurs, rôles et autorisations

- Identifier tous les types d’utilisateurs.
- Identifier tous les rôles.
- Identifier les permissions.
- Décrire précisément ce qu’un utilisateur peut faire selon son rôle.
- Vérifier si les permissions sont globales ou attribuées par page Facebook.
- Vérifier les relations suivantes :
  - un utilisateur → plusieurs pages ;
  - une page → plusieurs utilisateurs.
- Identifier le rôle administrateur ou super administrateur, s’il existe.
- Trouver les guards, middlewares, decorators ou autres contrôles d’accès.
- Produire une matrice d’autorisations au format suivant :

| Rôle | Ressource | Lecture | Création | Modification | Suppression | Actions particulières |
|---|---|---:|---:|---:|---:|---|
| À déterminer | À déterminer | À déterminer | À déterminer | À déterminer | À déterminer | À déterminer |

## 5. Facebook / Meta Graph API

Cette partie est particulièrement importante.

- Identifier la version de Graph API utilisée.
- Recenser tous les endpoints Meta appelés.
- Recenser toutes les permissions et tous les scopes demandés.
- Décrire le flux OAuth complet :
  - URL de callback ;
  - échange du code contre un token ;
  - gestion du paramètre `state` ;
  - récupération des pages administrées ;
  - récupération des Page Access Tokens ;
  - stockage des tokens ;
  - durée et type des tokens, si ces éléments sont gérés dans le code ;
  - rafraîchissement ou renouvellement éventuel.
- Rechercher notamment les permissions suivantes, sans supposer qu’elles sont utilisées :
  - `pages_show_list` ;
  - `pages_read_engagement` ;
  - `pages_manage_posts` ;
  - `pages_manage_engagement` ;
  - `pages_messaging` ;
  - toute autre permission réellement utilisée.
- Identifier les API permettant de :
  - récupérer les pages ;
  - récupérer les publications ;
  - récupérer les anciennes publications ;
  - récupérer les commentaires ;
  - récupérer les réponses ;
  - publier ;
  - répondre ;
  - récupérer les statistiques ou insights ;
  - synchroniser les données avec la base locale.
- Examiner la gestion de la pagination Meta (`paging`, `next`, `cursors`).
- Examiner la gestion des erreurs Graph API.
- Examiner la gestion des limites et rate limits, si elle existe.
- Identifier les mécanismes de retry.
- Identifier les éventuels Webhooks Meta.
- Décrire la synchronisation historique et celle des nouvelles données.
- Préciser ce qui fonctionne actuellement et ce qui reste en TODO.

## 6. Synchronisation Facebook ↔ base locale

- Identifier l’ensemble du workflow :
  - connexion de la page ;
  - récupération des données Facebook ;
  - transformation ;
  - insertion en base ;
  - mise à jour ;
  - gestion des doublons.
- Identifier la clé Facebook utilisée pour reconnaître :
  - une page ;
  - une publication ;
  - un commentaire ;
  - un utilisateur ou auteur.
- Examiner la détection des données déjà synchronisées.
- Identifier les éventuels `upsert`.
- Examiner la pagination.
- Examiner la synchronisation incrémentale.
- Examiner la synchronisation complète ou historique.
- Identifier la fréquence de synchronisation.
- Déterminer si la synchronisation repose sur un worker, un cron ou un endpoint manuel.
- Décrire le comportement lorsqu’une donnée est supprimée ou modifiée sur Facebook.
- Examiner la gestion des échecs partiels.
- Identifier les logs de synchronisation.
- Identifier une éventuelle date de dernière synchronisation.

## 7. IA / NLP / analyse des commentaires

- Identifier tous les composants IA.
- Identifier le modèle actuel d’analyse de sentiment.
- Recenser les bibliothèques ML/NLP.
- Décrire le prétraitement des textes.
- Identifier les features utilisées.
- Identifier les classes possibles, par exemple :
  - positif ;
  - neutre ;
  - négatif.
- Décrire le format du résultat.
- Identifier les éventuels scores ou niveaux de confiance.
- Préciser où le résultat est enregistré.
- Identifier le mode de déclenchement de l’analyse :
  - automatique ;
  - worker ;
  - manuel ;
  - endpoint.
- Identifier l’intervalle des workers ou crons.
- Identifier l’endpoint d’analyse.
- Déterminer si le modèle est entraîné localement ou pré-entraîné.
- Identifier le dataset utilisé, s’il est présent dans le dépôt.
- Recenser les langues prises en charge.
- Vérifier notamment la prise en charge du malagasy, du français et de l’anglais, si applicable.
- Identifier les TODO liés à CamemBERT ou à d’autres modèles.
- Identifier tout LLM utilisé et préciser :
  - le fournisseur ;
  - le modèle ;
  - le prompt système ;
  - la construction du prompt ;
  - le contexte envoyé au LLM.
- Examiner la génération automatique de réponses.
- Examiner la gestion du ton et de la personnalisation de la marque.
- Vérifier l’existence d’une validation humaine avant publication.
- Identifier le fallback lorsque l’IA échoue.
- Examiner l’orchestration FastAPI/LangGraph, si elle est présente.
- Produire le workflow suivant en l’adaptant au code réellement observé :

```text
Commentaire → récupération → analyse → classification → génération éventuelle → validation CM → réponse
```

## 8. Base de données et modèle de données

- Identifier chaque base utilisée.
- Préciser son type : PostgreSQL, MongoDB, Firebase, etc.
- Recenser toutes les entités, tables ou collections.
- Pour chacune, préciser :
  - les champs ;
  - leur type ;
  - la clé primaire ;
  - les clés étrangères ;
  - les contraintes ;
  - les index.
- Identifier les relations entre les entités suivantes, lorsqu’elles existent :
  - `User` ;
  - `Role` ;
  - `Page` ;
  - `Post` ;
  - `Comment` ;
  - `Sentiment` ;
  - `Analysis` ;
  - `AI Response` ;
  - `Notification` ;
  - `Token` ;
  - autres entités.
- Identifier les tables de liaison many-to-many.
- Recenser les migrations.
- Recenser les données initiales et seeds.
- Produire, si possible :
  - un diagramme ER ;
  - un diagramme Mermaid `erDiagram` ;
  - un résumé du modèle logique.
- Expliquer quelles données viennent de Facebook et lesquelles sont propres à l’application.

## 9. API internes

- Produire un inventaire complet des endpoints.
- Pour chaque endpoint, préciser :
  - la méthode HTTP ;
  - la route ;
  - le controller ou router ;
  - le service ;
  - l’authentification nécessaire ;
  - les rôles nécessaires ;
  - les paramètres ;
  - le body ;
  - la réponse ;
  - les erreurs principales ;
  - la base ou ressource manipulée.
- Regrouper les endpoints par domaine :
  - Auth ;
  - Users ;
  - Roles ;
  - Pages ;
  - Facebook ;
  - Posts ;
  - Comments ;
  - AI ;
  - Analytics ;
  - Notifications ;
  - Admin ;
  - autres domaines.
- Vérifier s’il existe une documentation Swagger/OpenAPI.

## 10. Application mobile

- Identifier le framework exact et sa version.
- Décrire la structure du router et de la navigation.
- Recenser tous les écrans.
- Pour chaque écran, préciser :
  - son rôle ;
  - les données affichées ;
  - l’API appelée ;
  - les actions possibles.
- Identifier les contextes et providers.
- Identifier les hooks personnalisés.
- Identifier les services API.
- Décrire la gestion de l’état.
- Décrire l’authentification.
- Décrire le stockage du token.
- Examiner les notifications.
- Examiner la gestion des erreurs.
- Examiner les états de chargement.
- Examiner la recherche.
- Examiner les filtres.
- Examiner les analytics.
- Examiner les fonctionnalités IA.
- Signaler tout écran mocké ou incomplet.

## 11. Application Web Admin

- Réaliser la même analyse que pour l’application mobile.
- Vérifier particulièrement :
  - la création de comptes ;
  - l’attribution des rôles ;
  - l’attribution des pages ;
  - la gestion utilisateur ↔ page ;
  - la connexion des pages Facebook ;
  - la liste de toutes les pages ;
  - la recherche ;
  - les filtres ;
  - les statistiques ;
  - les analytics ;
  - la supervision IA ;
  - la gestion des erreurs ;
  - le dashboard.
- Déterminer quelles fonctionnalités ont été déplacées du mobile vers le web.

## 12. Temps réel et notifications

- Identifier les technologies utilisées : WebSocket, Socket.IO, SSE, Firebase Cloud Messaging, OneSignal ou autre.
- Recenser les événements disponibles.
- Déterminer qui émet chaque événement.
- Déterminer qui écoute chaque événement.
- Examiner notamment les cas d’utilisation suivants :
  - nouveau commentaire ;
  - commentaire négatif ;
  - commentaire important ;
  - analyse terminée ;
  - réponse générée ;
  - nouvelle publication ;
  - erreur de synchronisation.
- Examiner le système de reconnexion.
- Identifier l’éventuel stockage des notifications.

## 13. Sécurité

- Identifier le mécanisme d’authentification.
- Déterminer l’usage de JWT, sessions ou OAuth.
- Examiner les access tokens.
- Examiner les refresh tokens.
- Identifier les durées d’expiration.
- Recenser les middlewares de sécurité.
- Examiner le hachage des mots de passe.
- Identifier la bibliothèque utilisée.
- Examiner le RBAC.
- Examiner la sécurité par page.
- Vérifier la protection des endpoints.
- Examiner la configuration CORS.
- Examiner la protection CSRF, si elle est pertinente.
- Examiner la validation des entrées.
- Examiner la sanitization.
- Examiner la gestion des secrets.
- Recenser les variables d’environnement utilisées sans jamais afficher leur valeur.
- Identifier où sont stockés les tokens Facebook.
- Vérifier si les tokens sont chiffrés.
- Rechercher les logs pouvant contenir des informations sensibles.
- Examiner la configuration HTTPS.
- Identifier les risques de sécurité visibles dans le code.
- Recenser les TODO liés à la sécurité.

## 14. Données personnelles et confidentialité

- Identifier toutes les données utilisateur enregistrées, notamment :
  - nom ;
  - e-mail ;
  - identifiant Facebook ;
  - photo ou avatar ;
  - tokens ;
  - commentaires ;
  - identifiants sociaux ;
  - historique ;
  - logs.
- Identifier où ces données sont stockées.
- Examiner la suppression de compte ou de données, si elle existe.
- Identifier toute politique de conservation codée.
- Rechercher les logs susceptibles d’enregistrer des données personnelles.
- Ne jamais afficher de données réelles dans le rapport d’audit.

## 15. Performance et robustesse

- Examiner la pagination.
- Examiner les mécanismes de cache.
- Examiner les index de base de données.
- Identifier le batch processing.
- Examiner les workers.
- Examiner les queues.
- Examiner les traitements asynchrones.
- Examiner les timeouts.
- Examiner les retries.
- Identifier un éventuel circuit breaker.
- Examiner la gestion des erreurs de l’API Meta.
- Examiner la gestion d’une perte de connexion.
- Examiner la gestion des réponses partielles.
- Identifier la taille maximale des requêtes.
- Examiner le rate limiting interne.
- Identifier les points potentiels de saturation.

## 16. Tests et qualité

- Recenser tous les fichiers de tests.
- Identifier les tests unitaires.
- Identifier les tests d’intégration.
- Identifier les tests E2E.
- Identifier les tests frontend.
- Identifier les tests backend.
- Recenser les scripts de test.
- Identifier la configuration de couverture, si elle existe.
- Examiner la configuration du lint.
- Examiner la configuration du formatter.
- Identifier SonarQube ou toute autre analyse statique.
- Identifier les tests API ou collections Postman.
- Indiquer clairement s’il n’existe aucun test automatisé.
- Distinguer ce qui peut uniquement être testé manuellement.
- Identifier la validation et la gestion des erreurs présentes dans le code.

## 17. Déploiement et infrastructure

- Recenser les Dockerfiles.
- Examiner Docker Compose.
- Examiner Podman.
- Identifier un éventuel déploiement Kubernetes ou OpenShift.
- Examiner Nginx.
- Examiner Firebase.
- Identifier l’hébergement frontend et backend.
- Recenser les ports.
- Recenser les variables d’environnement sans afficher leurs valeurs.
- Identifier les volumes.
- Identifier les réseaux.
- Identifier un éventuel stockage MinIO ou S3.
- Examiner la CI/CD.
- Identifier GitHub Actions, Azure DevOps ou toute autre plateforme similaire.
- Identifier les environnements de déploiement.
- Examiner le monitoring.
- Examiner les logs.
- Identifier Prometheus, Grafana, Loki, Mimir ou Tempo, s’ils sont présents.
- Identifier les mécanismes de sauvegarde éventuels.

## 18. Gestion du projet observable dans le dépôt

- Examiner l’historique Git.
- Examiner les branches.
- Examiner les tags et releases.
- Identifier les dates principales.
- Relever les messages de commits significatifs.
- Recenser les TODO et FIXME.
- Identifier les roadmaps.
- Identifier les fichiers Markdown de tâches.
- Identifier les éventuelles user stories.
- Identifier les sprints éventuellement documentés.
- Ne pas attribuer automatiquement une fonctionnalité à une personne simplement parce que son nom apparaît dans Git.
- Fournir néanmoins les informations qui permettront ensuite d’identifier la contribution de l’auteur du rapport.

## 19. Étude de l’existant

- Rechercher dans Git si une première version du système existait avant le travail actuel.
- Identifier ce qui était déjà présent.
- Identifier ce qui a été ajouté.
- Identifier ce qui a été modifié.
- Reconstruire l’ancienne architecture, si possible.
- Décrire l’architecture actuelle.
- Identifier les limitations de l’ancien système visibles dans le code ou dans les TODO.
- Produire une comparaison au format suivant :

| Avant | Problème ou limite | Modification réalisée | Situation actuelle |
|---|---|---|---|
| À déterminer | À déterminer | À déterminer | À déterminer |

Cette distinction est particulièrement importante dans le rapport MBDS : l’étude de l’existant doit décrire le système initial, tandis que la conception doit faire ressortir les changements et justifier les choix.

## 20. Données nécessaires pour l’état de l’art

- Extraire toutes les technologies effectivement utilisées afin d’identifier celles qui devront être comparées.
- Examiner les technologies des catégories suivantes :
  - frontend ;
  - backend ;
  - base de données ;
  - API sociale ;
  - NLP et analyse de sentiment ;
  - LLM ;
  - notifications ;
  - temps réel ;
  - authentification ;
  - stockage ;
  - déploiement.
- Pour chaque technologie choisie, chercher dans le code, les README, les ADR, les commentaires ou la documentation une éventuelle justification du choix.
- Identifier les anciennes technologies abandonnées.
- Ne pas réaliser de comparaison commerciale qui ne soit pas démontrée par le code ; la recherche documentaire externe sera effectuée séparément.

L’état de l’art devra comparer les alternatives puis justifier les choix, et non simplement décrire la stack.

## 21. Dépendances et licences

- Recenser uniquement les dépendances principales.
- Pour chaque dépendance, préciser :
  - la version ;
  - sa fonction dans le projet ;
  - sa licence, si elle est facilement identifiable.
- Identifier les packages abandonnés ou dépréciés détectables.
- Identifier les dépendances critiques.
- Identifier les bibliothèques IA.
- Identifier les SDK Meta, Firebase ou autres.

## 22. Mesures quantitatives pour le rapport et la conclusion

Calculer les mesures suivantes :

- nombre d’applications et de services ;
- nombre d’écrans ;
- nombre d’endpoints ;
- nombre de tables et collections ;
- nombre de rôles ;
- nombre de fonctionnalités principales ;
- nombre de services ;
- nombre de workers ;
- nombre de modèles IA ;
- nombre de tests ;
- nombre de fichiers de tests ;
- nombre approximatif de lignes de code par sous-projet, si pertinent ;
- nombre de migrations ;
- nombre de composants principaux ;
- nombre de TODO et FIXME ;
- nombre d’intégrations externes.

Ces chiffres doivent être calculés et ne doivent pas être estimés au hasard.

## 23. Fonctionnalités incomplètes et dette technique

- Recenser :
  - tous les TODO ;
  - tous les FIXME ;
  - les `NotImplemented` ;
  - les mocks ;
  - les données statiques ;
  - les placeholders ;
  - les fonctionnalités UI sans backend ;
  - les fonctionnalités backend sans UI ;
  - les endpoints non utilisés ;
  - le code mort évident ;
  - les commentaires signalant des problèmes ;
  - les erreurs connues ;
  - les fonctionnalités prévues mais non terminées.
- Classer chaque élément dans l’une des catégories suivantes :
  - terminé ;
  - fonctionnel mais perfectible ;
  - prototype ;
  - en cours ;
  - non implémenté.

## 24. Problèmes techniques rencontrés visibles dans le code

- Rechercher :
  - les workarounds ;
  - les anciennes implémentations commentées ;
  - les commits de correction ;
  - les changements d’architecture ;
  - les erreurs OAuth résolues ;
  - les problèmes liés à l’API Meta ;
  - les problèmes d’analyse de sentiment ;
  - les changements de modèles ;
  - les migrations de base de données ;
  - les problèmes de déploiement.
- Pour chaque problème, présenter les informations sous la forme suivante :

```text
Problème → cause → solution appliquée → résultat
```

Ces informations serviront directement à la conclusion, qui doit présenter un bilan des problèmes rencontrés et des solutions apportées.

## 25. Glossaire et acronymes

- Recenser automatiquement les termes techniques importants, notamment :
  - API ;
  - REST ;
  - JWT ;
  - OAuth ;
  - NLP ;
  - LLM ;
  - RBAC ;
  - CRUD ;
  - WebSocket ;
  - FCM ;
  - CI/CD ;
  - autres termes pertinents.
- Fournir leur signification.
- Ne conserver que les acronymes réellement utilisés dans le projet.

## 26. Format de sortie obligatoire pour l’agent

### Fichier principal

Créer un fichier principal nommé `CODE_AUDIT_REPORT.md`, avec une section pour chacun des thèmes ci-dessus.

Pour chaque information importante, utiliser le format suivant :

```text
Information : ...
Preuve : chemin/du/fichier:ligne
Code concerné : classe/fonction/composant
Niveau de certitude : confirmé / probable / non déterminé
```

### Fichiers complémentaires

Ajouter les fichiers suivants :

- `ARCHITECTURE.md`, avec les diagrammes Mermaid ;
- `API_INVENTORY.md` ;
- `DATABASE_MODEL.md` ;
- `FEATURE_INVENTORY.md` ;
- `AI_PIPELINE.md` ;
- `FACEBOOK_INTEGRATION.md` ;
- `SECURITY_AUDIT.md` ;
- `TODO_AND_LIMITATIONS.md` ;
- `PROJECT_METRICS.md`.

