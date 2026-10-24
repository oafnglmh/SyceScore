"""
API routes for AI settings (Gemini & Ollama).
"""
from fastapi import APIRouter, HTTPException

from ..models.schemas import (
    AddApiKeysRequest,
    ApiKeyInfo,
    AISettingsResponse,
    AISettingsUpdate,
    AITestRequest,
    AITestResponse,
    ModelsListResponse,
    OllamaStatusResponse,
    OllamaModelsListResponse,
    ResetKeysRequest,
)
from ..services.gemini.gemini_service import gemini_service
from ..services.ollama.ollama_service import ollama_service
from ..storage.ai_settings_store import ai_settings_store

router = APIRouter(tags=["ai"])


def _build_settings_response() -> AISettingsResponse:
    pool = ai_settings_store.get_key_pool()
    api_key_infos = [ApiKeyInfo(**item) for item in pool]
    active_keys = sum(1 for k in api_key_infos if k.status == "active")
    exhausted_keys = sum(1 for k in api_key_infos if k.status == "exhausted")

    return AISettingsResponse(
        is_configured=ai_settings_store.is_configured(),
        api_key_masked=ai_settings_store.get_masked_key(),
        model=ai_settings_store.get_model(),
        ocr_provider=ai_settings_store.get_ocr_provider(),
        ollama_model=ai_settings_store.get_ollama_model(),
        enable_cross_validation=ai_settings_store.get_cross_validation_enabled(),
        api_keys=api_key_infos,
        total_keys=len(api_key_infos),
        active_keys=active_keys,
        exhausted_keys=exhausted_keys,
        estimated_pages_remaining=active_keys * 20,
    )


@router.get("/settings/ai", response_model=AISettingsResponse)
async def get_ai_settings():
    return _build_settings_response()


@router.put("/settings/ai", response_model=AISettingsResponse)
async def update_ai_settings(data: AISettingsUpdate):
    if data.api_key is not None:
        key = data.api_key.strip()
        if key:
            if len(key) < 10:
                raise HTTPException(400, "API key quá ngắn, vui lòng kiểm tra lại")
            ai_settings_store.set_api_key(key)
    if data.model is not None:
        ai_settings_store.set_model(data.model.strip())
    if data.ocr_provider is not None:
        ai_settings_store.set_ocr_provider(data.ocr_provider.strip())
    if data.ollama_model is not None:
        ai_settings_store.set_ollama_model(data.ollama_model.strip())
    if data.enable_cross_validation is not None:
        ai_settings_store.set_cross_validation_enabled(data.enable_cross_validation)

    return _build_settings_response()


@router.post("/settings/ai/keys/add", response_model=AISettingsResponse)
async def add_api_keys(req: AddApiKeysRequest):
    added = ai_settings_store.add_keys_bulk(req.keys)
    if added == 0:
        raise HTTPException(
            400,
            "Không có API key mới nào được thêm (phải từ 10 ký tự trở lên và chưa tồn tại trong kho)"
        )
    return _build_settings_response()


@router.delete("/settings/ai/keys/{index}", response_model=AISettingsResponse)
async def delete_api_key(index: int):
    success = ai_settings_store.remove_key_by_index(index)
    if not success:
        raise HTTPException(404, "Không tìm thấy API key tại vị trí này")
    return _build_settings_response()


@router.post("/settings/ai/keys/reset", response_model=AISettingsResponse)
async def reset_keys_status(req: ResetKeysRequest):
    ai_settings_store.reset_key_status(req.key_index)
    return _build_settings_response()


@router.post("/settings/ai/keys/test-all")
async def test_all_keys():
    pool = ai_settings_store.get_key_pool()
    keys = ai_settings_store.get_api_keys()
    results = []
    for idx, plain_key in enumerate(keys):
        test_res = await gemini_service.test_connection(api_key=plain_key)
        masked = pool[idx]["masked_key"] if idx < len(pool) else f"...{plain_key[-4:]}"
        if test_res.get("success"):
            ai_settings_store.reset_key_status(idx)
            status = "active"
        else:
            msg = test_res.get("message", "")
            if "quota" in msg.lower() or "429" in msg or "resource" in msg.lower():
                ai_settings_store.mark_key_exhausted(idx, reason=msg)
                status = "exhausted"
            else:
                ai_settings_store.mark_key_error(idx, error_message=msg)
                status = "error"
        results.append({
            "index": idx,
            "masked_key": masked,
            "status": status,
            "message": test_res.get("message", ""),
        })
    return {
        "results": results,
        "settings": _build_settings_response(),
    }


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


# ─── Ollama Endpoints ────────────────────────────────────────────────────────

@router.get("/ai/ollama/status", response_model=OllamaStatusResponse)
async def get_ollama_status():
    available = ollama_service.is_available()
    test_res = await ollama_service.test_connection()
    return OllamaStatusResponse(
        available=available,
        success=test_res.get("success", False),
        message=test_res.get("message", ""),
        model=test_res.get("model"),
    )


@router.get("/ai/ollama/models", response_model=OllamaModelsListResponse)
async def get_ollama_models():
    raw_models = await ollama_service.list_models()
    models = []
    for m in raw_models:
        models.append({
            "name": m.get("name", ""),
            "size": m.get("size"),
            "digest": m.get("digest"),
            "modified_at": m.get("modified_at"),
        })
    return OllamaModelsListResponse(models=models)
