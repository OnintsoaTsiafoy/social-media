"""Download/cache the local model and check its dimensions before deployment."""
from modules.knowledge.pipeline import DIMENSIONS, embed, prepare

if __name__ == "__main__":
    result = prepare("Nos horaires sont du lundi au vendredi, de 9h à 18h.")
    vector = embed(["Quels sont vos horaires ?"], "query")[0]
    assert len(vector) == DIMENSIONS
    print(f"Ready: {result['model']}, {len(result['chunks'])} chunk, {len(vector)} dimensions")
