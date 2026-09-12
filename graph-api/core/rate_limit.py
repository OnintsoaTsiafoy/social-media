from slowapi import Limiter
from slowapi.util import get_remote_address

# Baseline protection against runaway retries/abuse (Sprint 05 Day 5). Per-route
# tuning (e.g. a stricter limit on publish/reply) can be layered on later with
# @limiter.limit("...") without changing this default.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
