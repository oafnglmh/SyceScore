"""
API routes for AI settings (Gemini only).
"""
from fastapi import APIRouter, HTTPException

from ..models.schemas import (
    AISettingsResponse,
    AISettingsUpdate,
    AITestRequest,
    AITestResponse,
    ModelsListResponse,
)
from ..services.gemini.gemini_service import gemini_service
from ..storage.ai_settings_store import ai_settings_store

router = APIRouter(tags=["ai"])


@router.get("/settings/ai", response_model=AISettingsResponse)
async def get_ai_settings():
    return AISettingsResponse(
        is_configured=ai_settings_store.is_configured(),
        api_key_masked=ai_settings_store.get_masked_key(),
        model=ai_settings_store.get_model(),
    )


@router.put("/settings/ai", response_model=AISettingsResponse)
async def update_ai_settings(data: AISettingsUpdate):
    if data.api_key:
        key = data.api_key.strip()
        if len(key) < 10:
            raise HTTPException(400, "API key quá ngắn, vui lòng kiểm tra lại")
        ai_settings_store.set_api_key(key)
    if data.model:
        ai_settings_store.set_model(data.model.strip())
    return AISettingsResponse(
        is_configured=ai_settings_store.is_configured(),
        api_key_masked=ai_settings_store.get_masked_key(),
        model=ai_settings_store.get_model(),
    )


@router.post("/ai/test", response_model=AITestResponse)
async def test_ai_connection(req: AITestRequest):
    result = await gemini_service.test_connection(
        api_key=req.api_key,
        model=req.model,
    )
    return AITestResponse(**result)


@router.get("/ai/models", response_model=ModelsListResponse)
async def get_available_models():
    models = await gemini_service.list_models()
    return ModelsListResponse(models=models)
