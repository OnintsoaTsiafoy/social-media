from fastapi import FastAPI

from api.routes.facebook_routes import router as facebook_router
from api.routes.health import router as health_router
from core.config import settings

app = FastAPI(title=settings.app_name)

app.include_router(health_router)
app.include_router(facebook_router)
