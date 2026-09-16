"""Ce que Meta laisse réellement lire d'un compte qu'on ne gère pas.

Table de référence de la section 1 du TODO analyse concurrentielle, tenue ici
plutôt que seulement dans la documentation : c'est elle qui décide quels
champs sont demandés à Meta et lesquels restent nuls par construction. Une
métrique absente de `*_PUBLIC_FIELDS` n'est jamais devinée ni remplacée par 0.

Établi d'après la documentation Meta en vigueur (Graph API v25, Instagram
Platform « Business Discovery », Facebook « Page Public Content Access »), et
NON vérifié en direct avec un token réel : aucune application Meta n'est
configurée dans cet environnement. Le TODO l'exige explicitement — « Ne jamais
considérer une métrique comme disponible tant qu'elle n'a pas été testée avec
le token et l'application Meta du projet ». Le code est donc écrit pour que
chaque champ puisse s'avérer indisponible sans rien casser : tout champ manquant
dans la réponse Meta ressort `None` et remonte dans `unavailableFields`, et
`docs/ANALYSE_CONCURRENTIELLE.md` liste les vérifications à cocher le jour où
un token réel existe.
"""

# --- Facebook ---------------------------------------------------------------
# Lire une Page qu'on n'administre pas suppose la feature « Page Public
# Content Access », soumise à App Review (section 12). Sans elle, Meta répond
# une erreur de permission sur ces mêmes champs : c'est le cas
# PERMISSION_REQUIRED, pas une absence de données.
FACEBOOK_PROFILE_FIELDS = "id,name,username,link,fan_count,followers_count,picture{url}"

# `shares` est un objet {count} sur Facebook, absent quand le post n'a jamais
# été partagé. `reactions`/`comments` sont demandés en résumé avec limit(0) :
# seul le total compte ici, jamais le détail nominatif des auteurs — c'est de
# la donnée personnelle dont l'analyse concurrentielle n'a aucun usage.
FACEBOOK_POST_FIELDS = (
    "id,message,created_time,permalink_url,shares,"
    "reactions.summary(total_count).limit(0),"
    "comments.summary(total_count).limit(0),"
    "attachments{media_type}"
)

# --- Instagram --------------------------------------------------------------
# « Business Discovery » est le seul accès officiel aux comptes professionnels
# concurrents : la requête part TOUJOURS du compte Instagram de la marque
# (`/{ig-user-id}?fields=business_discovery.username(...)`), jamais d'une
# lecture directe du compte visé. Conséquences assumées :
#   - le concurrent doit être un compte professionnel (Business ou Creator) ;
#     un compte personnel est illisible et ressort UNAVAILABLE ;
#   - la marque doit avoir un compte Instagram professionnel connecté ; sans
#     lui, aucun concurrent Instagram n'est analysable.
INSTAGRAM_PROFILE_FIELDS = (
    "id,username,name,profile_picture_url,biography,website,followers_count,media_count"
)
INSTAGRAM_POST_FIELDS = (
    "id,caption,like_count,comments_count,media_type,permalink,timestamp"
)

# --- Audience du compte de la marque ---------------------------------------
# Comptes qu'on administre : pas de PPCA ni de Business Discovery, des champs
# directs. Sert au calcul comparable du taux d'engagement (section 8).
FACEBOOK_SELF_AUDIENCE_FIELDS = "id,name,fan_count,followers_count"
INSTAGRAM_SELF_AUDIENCE_FIELDS = "id,username,followers_count,media_count"

# --- Ce que Meta ne donne jamais d'un concurrent ----------------------------
# Documenté pour être affiché tel quel côté mobile (section 11) plutôt que
# rendu par un 0 trompeur. Ces métriques relèvent des Insights, réservés aux
# comptes que l'application administre.
NEVER_AVAILABLE_FOR_COMPETITORS = {
    "reach": "La portée est une métrique Insights, réservée aux comptes administrés.",
    "impressions": "Les impressions sont une métrique Insights, réservées aux comptes administrés.",
    "saves": "Les enregistrements ne sont exposés que pour ses propres médias.",
    "profileVisits": "Les visites de profil ne sont exposées que pour son propre compte.",
    "demographics": "Les données démographiques d'audience ne sont jamais publiques.",
}

# Instagram n'expose pas de compteur de partages en Business Discovery, et
# Facebook n'expose pas d'équivalent d'abonnés distinct des mentions J'aime sur
# toutes les Pages : ces trous-là sont par réseau, pas universels.
UNSUPPORTED_BY_PLATFORM = {
    "INSTAGRAM": {"shares": "Instagram n'expose pas de compteur de partages via Business Discovery."},
    "FACEBOOK": {},
}


# --- Classement des refus Meta ---------------------------------------------
# Un refus Meta n'est pas une panne : il dit quelque chose de durable sur le
# concurrent (compte illisible) ou sur l'application (permission manquante).
# Les trois cas mènent à des actions différentes côté produit — d'où les trois
# statuts distincts du TODO plutôt qu'un « erreur » unique.
_PERMISSION_CODES = {
    10,   # (#10) Page Public Content Access non approuvé pour cette application
    190,  # token invalide/expiré : reconnexion nécessaire
    200,  # permission manquante sur l'objet visé
    299,  # permission manquante (variante)
}
_PERMISSION_SUBCODES = {
    2018233,  # PPCA explicitement exigé
}
_UNAVAILABLE_CODES = {
    21,   # Page migrée / fusionnée
    110,  # identifiant utilisateur invalide (compte personnel, compte supprimé)
    803,  # objet introuvable ou non lisible avec ce token
}
_UNAVAILABLE_SUBCODES = {
    33,       # « Unsupported get request » : objet inexistant OU illisible
    2207013,  # Business Discovery : compte introuvable ou non professionnel
}
# Limites de débit : transitoires par définition, la prochaine exécution
# retentera (section 7 « Respecter les rate limits Meta »).
_RATE_LIMIT_CODES = {4, 17, 32, 613}


def classify_meta_failure(status_code: int, meta_code, meta_subcode) -> str:
    """Traduit un refus Meta en `CompetitorStatus`.

    `meta_code`/`meta_subcode` viennent du corps d'erreur Graph API
    (`error.code`, `error.error_subcode`) ; ils peuvent être absents, auquel
    cas seul le statut HTTP tranche.
    """
    code = meta_code if isinstance(meta_code, int) else None
    subcode = meta_subcode if isinstance(meta_subcode, int) else None

    if subcode in _PERMISSION_SUBCODES or code in _PERMISSION_CODES:
        return "PERMISSION_REQUIRED"
    if subcode in _UNAVAILABLE_SUBCODES or code in _UNAVAILABLE_CODES:
        return "UNAVAILABLE"
    if code in _RATE_LIMIT_CODES or status_code == 429:
        return "SYNC_ERROR"
    if status_code == 403:
        return "PERMISSION_REQUIRED"
    if status_code == 404:
        return "UNAVAILABLE"
    # Tout le reste (5xx, timeouts, erreurs inconnues) est traité comme
    # transitoire : mieux vaut retenter une Page réellement disparue que
    # marquer définitivement indisponible un concurrent victime d'un incident.
    return "SYNC_ERROR"
