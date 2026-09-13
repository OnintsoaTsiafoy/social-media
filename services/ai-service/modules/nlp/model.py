"""Définition du classifieur, partagée par l'entraînement et le service.

Le `preprocessor=normalise` passé au vectoriseur est ce qui garantit
structurellement la parité entraînement/inférence : l'objet sérialisé porte la
référence vers `modules.nlp.preprocessing.normalise`, donc le service ne *peut
pas* normaliser autrement que ce qui a été appris.
"""
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

from modules.nlp.preprocessing import normalise

# Les n-grammes de caractères font le gros du travail sur des commentaires
# sociaux : ils absorbent les fautes (« comande »), les abréviations SMS et
# l'absence d'accents, là où les n-grammes de mots seuls verraient des tokens
# inconnus. Les deux branches sont gardées : les mots restent nécessaires pour
# produire une explication lisible (voir `explain_terms`).
WORD_BRANCH = "word"
CHAR_BRANCH = "char"


def build_classifier(regularisation: float, seed: int) -> Pipeline:
    return Pipeline(
        [
            (
                "features",
                FeatureUnion(
                    [
                        (
                            WORD_BRANCH,
                            TfidfVectorizer(
                                preprocessor=normalise,
                                analyzer="word",
                                ngram_range=(1, 2),
                                min_df=2,
                                sublinear_tf=True,
                            ),
                        ),
                        (
                            CHAR_BRANCH,
                            TfidfVectorizer(
                                preprocessor=normalise,
                                analyzer="char_wb",
                                ngram_range=(3, 5),
                                min_df=2,
                                sublinear_tf=True,
                            ),
                        ),
                    ]
                ),
            ),
            (
                "classifier",
                LogisticRegression(
                    C=regularisation,
                    max_iter=2000,
                    # Les classes sont déséquilibrées (`question` est trois fois
                    # moins représentée que `other`) : sans rééquilibrage le
                    # modèle gagnerait en exactitude globale en abandonnant
                    # simplement les classes rares.
                    class_weight="balanced",
                    random_state=seed,
                ),
            ),
        ]
    )


def explain_terms(pipeline: Pipeline, text: str, predicted: str, limit: int = 3) -> list[str]:
    """Termes ayant réellement porté la prédiction, lus dans les coefficients.

    Seule la branche « mots » est utilisée : un n-gramme de caractères comme
    « mbou » est un excellent trait mais une explication illisible.
    """
    features: FeatureUnion = pipeline.named_steps["features"]
    classifier: LogisticRegression = pipeline.named_steps["classifier"]
    vectoriser: TfidfVectorizer = dict(features.transformer_list)[WORD_BRANCH]

    classes = list(classifier.classes_)
    if predicted not in classes:
        return []

    row = vectoriser.transform([text])
    if row.nnz == 0:
        return []

    names = vectoriser.get_feature_names_out()
    # Binaire : scikit-learn ne stocke qu'un vecteur de coefficients, orienté
    # vers classes_[1] — il faut l'inverser pour expliquer classes_[0].
    if len(classes) == 2:
        coefficients = classifier.coef_[0]
        if predicted == classes[0]:
            coefficients = -coefficients
    else:
        coefficients = classifier.coef_[classes.index(predicted)]

    indices = row.indices
    contributions = row.data * coefficients[indices]
    ranked = np.argsort(-contributions)

    terms: list[str] = []
    for position in ranked:
        if contributions[position] <= 0:
            break
        term = names[indices[position]]
        # Les marqueurs internes (tokurl, toknum, neg_…) ne veulent rien dire
        # pour un community manager.
        if term.startswith(("tok", "neg_", "emo")) or len(term) < 3:
            continue
        if term in terms:
            continue
        terms.append(term)
        if len(terms) == limit:
            break
    return terms
