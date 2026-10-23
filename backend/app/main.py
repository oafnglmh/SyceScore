"""
FastAPI application entry point.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.ai_settings import router as ai_router
from .api.reconciliations import router as reconciliation_router
from .core.config import settings

logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger = logging.getLogger(__name__)
    logger.info(f"{settings.APP_NAME} backend starting...")
    try:
        from .storage.session_store import session_store
        cleaned = session_store.cleanup_stale_sessions()
        if cleaned > 0:
            logger.info(f"Đã cập nhật trạng thái lỗi cho {cleaned} phiên đối soát bị gián đoạn trước đó.")
    except Exception as e:
        logger.warning(f"Lỗi khi dọn dẹp phiên dở dang: {e}")
    yield
    # Shutdown
    logging.getLogger(__name__).info("Backend shutting down.")


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="API backend for CCE ScoreSync – exam score reconciliation system",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Register routers
app.include_router(reconciliation_router, prefix="/api")
app.include_router(ai_router, prefix="/api")


@app.get("/api/health")
async def health_check():
    from .storage.ai_settings_store import ai_settings_store
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "ai_configured": ai_settings_store.is_configured(),
        "ai_model": ai_settings_store.get_model(),
    }
