# Fichiers legacy

Les cinq fichiers `Servlet*.java` de ce dossier sont d'anciens proxies Java
(`javax.servlet.http.HttpServlet`) qui relayaient des appels HTTP vers ce
service, avant sa réécriture en FastAPI. Ils ne font **pas** partie de
l'application qui tourne aujourd'hui :

- aucun fichier Python de `graph-api/` ne les importe ni ne les référence ;
- il n'existe ni `pom.xml` ni `build.gradle` dans ce dépôt pour les compiler ;
- aucun `Dockerfile` ne les construit ou ne les exécute ;
- le `Dockerfile` de `graph-api/` ne construit que l'application FastAPI
  (`main.py` et les modules Python).

Ils sont conservés uniquement comme référence historique du comportement
attendu de certaines routes (`/api/health`, `/facebook/posts`, etc.), au cas
où un désaccord apparaîtrait sur un comportement d'origine.

## Ce qui a changé en les déplaçant ici (Sprint 05)

- Déplacés de `api/routes/` (à côté du code exécuté) vers `legacy/`, pour ne
  plus laisser croire qu'ils font partie des routes actives.
- L'adresse IP interne codée en dur (`BACKEND_IP`) qu'ils contenaient tous a
  été remplacée par un placeholder — elle n'avait aucune valeur opérationnelle
  ici mais n'avait pas sa place dans un dépôt partagé.

## Règles pour la suite

- Ne pas construire la nouvelle architecture (`/internal/v1`, OAuth, Instagram)
  autour de ces fichiers : ce sont des `api/routes/facebook_routes.py`,
  `api/routes/internal_routes.py` et les modules sous `modules/` qu'il faut
  étendre.
- Si un jour ces fichiers sont jugés inutiles, ils peuvent être supprimés sans
  impact runtime — à confirmer avec l'équipe avant suppression définitive.
