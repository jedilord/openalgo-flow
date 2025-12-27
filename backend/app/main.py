from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
import logging

from app.core.config import settings
from app.core.database import create_tables
from app.core.scheduler import workflow_scheduler
from app.core.rate_limit import limiter
from app.api.routes import settings as settings_router
from app.api.routes import workflows as workflows_router
from app.api.routes import symbols as symbols_router
from app.api.routes import auth as auth_router
from app.api.routes import webhook as webhook_router
from app.api import websocket as websocket_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting OpenAlgo Flow...")
    await create_tables()
    workflow_scheduler.init()
    logger.info("OpenAlgo Flow started successfully")
    yield
    # Shutdown
    logger.info("Shutting down OpenAlgo Flow...")
    workflow_scheduler.shutdown()


app = FastAPI(
    title=settings.app_name,
    description="Visual workflow editor for OpenAlgo trading automation",
    version="1.0.0",
    lifespan=lifespan
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router.router, prefix=settings.api_prefix)
app.include_router(settings_router.router, prefix=settings.api_prefix)
app.include_router(workflows_router.router, prefix=settings.api_prefix)
app.include_router(symbols_router.router, prefix=settings.api_prefix)
app.include_router(webhook_router.router, prefix=settings.api_prefix)  # Public webhook endpoint
app.include_router(websocket_router.router)


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
