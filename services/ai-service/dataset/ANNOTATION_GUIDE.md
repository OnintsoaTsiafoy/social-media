# Guide d'annotation — commentaires sociaux francophones

Version du guide : `1.0` — correspond au dataset `comments.v1.jsonl`.

Ce guide est la définition de référence des classes. Il sert à deux choses :
annoter de nouveaux commentaires de façon cohérente, et arbitrer les cas
limites de la même manière qu'ils l'ont été pour le dataset initial. Toute
modification du guide impose une nouvelle version du dataset.

## Périmètre

Commentaires publics laissés par des internautes sous une publication de
marque (Facebook / Instagram), en français. Le texte est pris **tel quel** :
fautes, abréviations SMS, emojis, majuscules et absence de ponctuation font
partie du signal et ne sont jamais corrigés à l'annotation.

Les commentaires réels sont anonymisés avant d'entrer dans le dataset :
prénoms remplacés par des prénoms neutres, numéros de commande réécrits,
adresses/e-mails/téléphones supprimés ou remplacés par un équivalent
factice. Aucun identifiant Meta n'est conservé.

## Axe 1 — `sentiment`

Ce que **l'auteur ressent envers la marque ou le produit**, pas le ton
général du message.

| Classe | Définition | Indices typiques |
|---|---|---|
| `positive` | Satisfaction, enthousiasme, remerciement, compliment. | « j'adore », « merci beaucoup », « parfait », emojis cœur, superlatifs |
| `neutral` | Aucune charge affective : demande factuelle, information, remarque descriptive. | question sèche, « bonjour, est-ce que… », constat sans jugement |
| `negative` | Insatisfaction, critique, déception, colère, méfiance. | « inadmissible », « déçu », « toujours rien », ironie, majuscules de colère |

Règles d'arbitrage :

- **Un message mixte prend le sentiment de sa demande principale.** « Super
  produit mais livraison catastrophique, je veux un remboursement » →
  `negative` : le compliment est une politesse d'entrée, la plainte porte le
  message.
- **Une question polie n'est pas positive.** « Bonjour, avez-vous ce modèle
  en 42 ? » → `neutral`. « Bonjour » et « merci d'avance » sont des formules,
  pas de la satisfaction.
- **L'ironie compte comme négative** quand elle est lisible sans contexte
  externe : « bravo pour le service client 👏 3 semaines sans réponse » →
  `negative`.
- **Un emoji seul** est annoté sur sa valeur conventionnelle : `❤️` / `😍`
  → `positive`, `😡` / `👎` → `negative`, `🤔` seul → `neutral`.

## Axe 2 — `intent`

Ce que l'auteur **attend concrètement** du community manager. Un seul label :
en cas de cumul, l'intention qui appelle une action prend le dessus
(`claim` > `complaint` > `info_request` > `question` > `other`).

| Classe | Définition | Contre-exemple fréquent |
|---|---|---|
| `question` | Question ouverte ou d'opinion, sans enjeu commercial immédiat. « Vous les fabriquez où ? » | Une question sur un prix est `info_request`, pas `question`. |
| `info_request` | Demande d'information pratique ou commerciale précise : prix, stock, taille, horaires, délai, point de vente, compatibilité. | « Où est ma commande ? » est `claim` : elle porte sur un dossier existant. |
| `complaint` | Exprime un mécontentement **sans demander de réparation** : critique du produit, du prix, d'une campagne, du service. | Si une action est réclamée (remboursement, échange, rappel), c'est `claim`. |
| `claim` | Réclamation sur un **cas personnel identifiable**, avec une réparation attendue : commande non reçue, remboursement, produit défectueux, erreur de facturation, SAV. | Une critique générale sans dossier reste `complaint`. |
| `other` | Tout le reste : compliment, remerciement, identification d'un ami, spam, hors-sujet, emoji seul. | |

Règles d'arbitrage :

- **`complaint` vs `claim` : la question est « y a-t-il un dossier à
  ouvrir ? »**. « Vos prix ont trop augmenté » → `complaint`. « Commande
  #A-4471 jamais livrée, je veux un remboursement » → `claim`.
- **`question` vs `info_request` : la question est « la réponse est-elle
  une donnée commerciale ? »**. Prix, stock, taille, horaire, délai →
  `info_request`. Origine, composition, avis, curiosité → `question`.
- **Un compliment qui contient une question prend la question.** « Magnifique
  collection ❤️ elle sort quand ? » → `info_request`.
- **Le spam et les identifications d'amis sont `other`**, quel que soit leur
  sentiment apparent.

## Axe 3 — `urgent` (booléen)

Vrai quand un retard de traitement **aggrave concrètement la situation**.
C'est une propriété du risque, pas de l'intensité émotionnelle : un message
très en colère sur le design d'un logo n'est pas urgent.

Vrai si au moins un de ces éléments est présent :

- menace juridique ou de signalement (avocat, mise en demeure, plainte,
  répression des fraudes, médiateur, association de consommateurs) ;
- menace publique explicite (« je poste partout », « j'appelle la presse ») ;
- relance après absence de réponse (« toujours aucune réponse depuis
  15 jours », « je relance pour la 3e fois », « personne ne décroche ») ;
- échéance datée (« mariage samedi », « départ demain », « pour Noël »),
  y compris une annulation à obtenir avant expédition ;
- **blocage opérationnel en cours** : le client ne peut pas commander, payer,
  se connecter ou utiliser le produit *maintenant* (site en panne, compte
  suspendu, appareil qui ne s'allume plus, compte piraté) ;
- **attente citée supérieure à 14 jours** (« commandé il y a 2 mois »,
  « depuis 6 semaines ») — le seuil correspond au délai légal de
  remboursement, au-delà duquel le dossier se dégrade juridiquement ;
- **prélèvement contesté** : de l'argent a déjà été pris à tort (double
  débit, prélèvement après résiliation, facturation d'un service jamais
  souscrit) ;
- incident sur la santé ou la sécurité (voir `sensitive`) ;
- incident de discrimination ou de harcèlement, ou situation impliquant un
  mineur.

> Les six premiers critères étaient seuls prévus à la rédaction initiale du
> guide. Les suivants ont été ajoutés après mesure : les annotations réelles
> marquaient couramment comme urgents des blocages en cours et des attentes
> longues, que la définition d'origine ne couvrait pas — le guide était
> incomplet, pas les annotations. Voir `docs/SPRINT_09_*.md`.

**Ne sont pas urgents**, malgré les apparences : une durée qui mesure une
ancienneté de client (« client depuis 10 ans », « satisfaite après 2 ans
d'utilisation »), une question sur un allergène ou un régime posée *avant*
achat (sensible, mais personne n'est en danger), et un reproche de pratique
commerciale déloyale (publicité trompeuse, avis modérés) qui ne s'aggrave pas
en quelques heures.

## Axe 4 — `sensitive` (booléen)

Vrai quand le message contient un sujet qui **interdit une réponse
automatique standard** et impose une relecture humaine :

- santé, blessure, allergie, réaction indésirable, hospitalisation ;
- données personnelles exposées publiquement par l'auteur (téléphone,
  e-mail, adresse postale, IBAN, numéro de carte) ;
- mineur impliqué ;
- accusation de discrimination, harcèlement, racisme, sexisme ;
- menace juridique formalisée ;
- accusation de fraude ou de vol visant la marque.

`urgent` et `sensitive` sont indépendants : une allergie est `sensitive` et
`urgent` ; un e-mail laissé en clair dans un commentaire de félicitations est
`sensitive` sans être `urgent`.

## Ce que le dataset ne couvre pas

Documenté explicitement pour que les métriques ne soient pas lues comme une
promesse de production :

- **Une seule langue.** Le français uniquement. Un commentaire en anglais ou
  en arabe (langues pourtant supportées par le profil de marque) n'est ni
  annoté ni représenté ; le service les détecte comme hors périmètre plutôt
  que de les classer au hasard.
- **Pas de contexte de publication.** L'annotation ne regarde que le texte du
  commentaire, jamais le post auquel il répond. Une ironie qui n'est lisible
  qu'avec le post reste donc mal classée.
- **Pas de fil de discussion.** Les réponses à d'autres commentaires sont
  annotées isolément.
- **Sarcasme et humour** restent la source d'erreur principale et assumée.
- **Volume.** Quelques centaines d'exemples : suffisant pour un modèle
  linéaire et des métriques honnêtes, insuffisant pour les classes rares
  (voir `docs/` et `artifacts/metrics.json` pour le détail par classe).
