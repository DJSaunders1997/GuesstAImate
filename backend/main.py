import json
import logging
import os
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

from ai_service import AIService, EXT_MAP, MAX_AUDIO_BYTES
from models import (
    AddResponse,
    DeleteResponse,
    EditResponse,
    HealthResponse,
    ImageRequest,
    ImageResponse,
    MultiResponse,
    TrackResponse,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── APP ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="GuesstAImate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_api_key = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=_api_key)
ai = AIService(client)


@app.on_event("startup")
async def startup_event():
    logger.info("=" * 50)
    logger.info("GuesstAImate API starting up")
    if not _api_key or _api_key.startswith("sk-your"):
        logger.warning(
            "OPENAI_API_KEY is not set or is still the placeholder - requests will fail!"
        )
    else:
        logger.info("OPENAI_API_KEY loaded (%s...%s)", _api_key[:8], _api_key[-4:])
    logger.info("=" * 50)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    logger.info("--> %s %s", request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled exception during %s %s", request.method, request.url.path
        )
        return JSONResponse(
            status_code=500, content={"detail": "Internal server error"}
        )
    elapsed = (time.perf_counter() - start) * 1000
    logger.info(
        "<-- %s %s  %d  (%.0f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


def _parse_entries(entries: str) -> list[dict]:
    try:
        parsed = json.loads(entries)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, ValueError):
        return []


def _transcribe(data: bytes, content_type: str) -> tuple[str, str]:
    suffix = EXT_MAP.get(content_type, ".webm")
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name
        return ai.transcribe_audio(tmp_path), tmp_path
    except Exception:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


def _build_add_response(result: dict, transcript: str) -> dict:
    items = ai.normalise_add_items(result.get("items", []))
    return {"intent": "add", "items": items, "transcript": transcript}


def _build_edit_response(result: dict, transcript: str) -> dict:
    entry_id = result.get("entry_id")
    if entry_id is None:
        raise HTTPException(
            status_code=422,
            detail="Could not identify which entry to edit. Try being more specific.",
        )
    return {
        "intent": "edit",
        "entry_id": entry_id,
        "updates": result.get("updates", {}),
        "transcript": transcript,
    }


def _build_delete_response(result: dict, transcript: str) -> dict:
    entry_id = result.get("entry_id")
    if entry_id is None:
        raise HTTPException(
            status_code=422,
            detail="Could not identify which entry to delete. Try being more specific.",
        )
    return {"intent": "delete", "entry_id": entry_id, "transcript": transcript}


def _process_multi_action(action: dict) -> dict:
    sub_intent = action.get("intent")
    if sub_intent == "add":
        return {
            "intent": "add",
            "items": ai.normalise_add_items(action.get("items", [])),
        }
    if sub_intent == "edit":
        entry_id = action.get("entry_id")
        if entry_id is None:
            raise HTTPException(
                status_code=422,
                detail="Could not identify which entry to edit. Try being more specific.",
            )
        return {
            "intent": "edit",
            "entry_id": entry_id,
            "updates": action.get("updates", {}),
        }
    if sub_intent == "delete":
        entry_id = action.get("entry_id")
        if entry_id is None:
            raise HTTPException(
                status_code=422,
                detail="Could not identify which entry to delete. Try being more specific.",
            )
        return {"intent": "delete", "entry_id": entry_id}
    raise HTTPException(
        status_code=422, detail=f"Unknown sub-intent in multi: {sub_intent}"
    )


def _build_multi_response(result: dict, transcript: str) -> dict:
    actions = [_process_multi_action(a) for a in result.get("actions", [])]
    return {"intent": "multi", "actions": actions, "transcript": transcript}


@app.post("/track", response_model=TrackResponse)
async def track(
    audio: UploadFile = File(..., description="Recorded audio file (webm/ogg/mp4)"),
    entries: str = Form(default="[]", description="JSON array of today's log entries for edit/delete context"),
):
    """Transcribe audio and classify intent (add / edit / delete / multi).

    Accepts:
      - audio:   the recorded audio file
      - entries: JSON string of today's log entries (id, food, calories, macros)
                 used as context for edit/delete matching

    Returns one of:
      {"intent": "add",    "items": [...],                        "transcript": "..."}
      {"intent": "edit",   "entry_id": <int>, "updates": {...},  "transcript": "..."}
      {"intent": "delete", "entry_id": <int>,                    "transcript": "..."}
      {"intent": "multi",  "actions": [...],                      "transcript": "..."}
    """
    data = await audio.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit.")

    existing_entries = _parse_entries(entries)
    content_type = (audio.content_type or "audio/webm").split(";")[0].strip()

    tmp_path = None
    try:
        transcript_text, tmp_path = _transcribe(data, content_type)
        logger.info("Whisper transcript: %s", transcript_text)

        if not transcript_text:
            raise HTTPException(
                status_code=422, detail="Could not understand audio. Please try again."
            )

        result = ai.classify_intent(transcript_text, existing_entries)
        intent = result.get("intent", "add")

        handlers = {
            "add": _build_add_response,
            "edit": _build_edit_response,
            "delete": _build_delete_response,
            "multi": _build_multi_response,
        }
        if intent not in handlers:
            raise HTTPException(status_code=422, detail=f"Unknown intent: {intent}")
        return handlers[intent](result, transcript_text)

    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="AI returned an unexpected format. Please try again.",
        )
    except KeyError as exc:
        raise HTTPException(status_code=500, detail=f"AI response missing field: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/image", response_model=ImageResponse)
async def generate_image(body: ImageRequest):
    """Generate a DALL-E 2 food image for a given food name."""
    food = body.food.strip()
    if not food:
        raise HTTPException(status_code=400, detail="food field is required.")
    data_url = ai.generate_food_image(food)
    return ImageResponse(data_url=data_url)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


# ---------------------------------------------------------------------------
# Serve the frontend — only when the ../frontend directory exists (local dev).
# In production the frontend is on GitHub Pages; this block is a no-op there.
# ---------------------------------------------------------------------------
_FRONTEND = Path(__file__).parent.parent / "frontend"
if _FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")
