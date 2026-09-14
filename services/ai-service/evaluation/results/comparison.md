# Vérification locale, sans LLM

Corpus synthétique. Aucun score humain ni taux d’acceptation n’a été simulé.

| Stratégie | Cas | Source attendue retrouvée | Questions absentes sans source | Questions sans réponse bloquées | Temps moyen |
|---|---:|---:|---:|---:|---:|
| llm | 12 | 0% | 100% | 0% | 11 ms |
| rag | 12 | 88% | 75% | 100% | 25 ms |
| rag_feedback | 12 | 88% | 75% | 100% | 24 ms |

Le mode local propose des extraits à adapter et bloque leur acceptation directe. Ces taux de blocage ne mesurent pas la capacité d’un LLM à s’abstenir.

Remplir human-ratings.csv pour mesurer pertinence, exactitude, ton, règles de marque, acceptation et satisfaction. Les durées excluent le chargement initial du modèle.

Les exemples humains du corpus sont synthétiques et distincts des commentaires évalués. Répéter sur un jeu indépendant avec de vrais évaluateurs avant toute conclusion de mémoire.
