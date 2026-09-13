FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# Les modèles sont entraînés à la construction de l'image, pas versionnés dans
# Git : un artefact joblib est lié à la version exacte de scikit-learn qui l'a
# produit, et un binaire commité se désynchronise silencieusement du dataset
# qu'il est censé refléter. L'entraînement prend quelques secondes (modèle
# linéaire, 535 exemples) et la graine est fixée, donc l'image reste
# reproductible. `evaluate` est lancé dans la foulée pour que
# /internal/v1/models/info puisse servir les métriques réelles du modèle
# embarqué, et non celles d'une exécution antérieure.
RUN python -m training.train && python -m training.evaluate

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
