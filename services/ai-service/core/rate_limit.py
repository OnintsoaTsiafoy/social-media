from slowapi import Limiter
from slowapi.util import get_remote_address

# Même protection de base que graph-api. L'analyse est bornée en CPU (un
# modèle linéaire, pas un LLM) mais la limite protège d'une boucle de rejeu
# côté worker qui saturerait le service.
limiter = Limiter(key_func=get_remote_address, default_limits=["240/minute"])
