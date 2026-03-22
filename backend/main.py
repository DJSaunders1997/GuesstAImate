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

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

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


@app.post("/track")
async def track(
    audio: UploadFile = File(...),
    entries: str = Form(default="[]"),
):
    """Transcribe audio and classify intent (add / edit / delete).

    Accepts:
      - audio:   the recorded audio file
      - entries: JSON string of today's log entries (id, food, calories, macros)
                 used as context for edit/delete matching

    Returns one of:
      {"intent": "add",    "items": [...],    "transcript": "..."}
      {"intent": "edit",   "entry_id": <int>, "updates": {...}, "transcript": "..."}
      {"intent": "delete", "entry_id": <int>, "transcript": "..."}
    """
    data = await audio.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit.")

    try:
        existing_entries = json.loads(entries)
        if not isinstance(existing_entries, list):
            existing_entries = []
    except (json.JSONDecodeError, ValueError):
        existing_entries = []

    content_type = (audio.content_type or "audio/webm").split(";")[0].strip()
    suffix = EXT_MAP.get(content_type, ".webm")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        transcript_text = ai.transcribe_audio(tmp_path)
        logger.info("Whisper transcript: %s", transcript_text)

        if not transcript_text:
            raise HTTPException(
                status_code=422, detail="Could not understand audio. Please try again."
            )

        result = ai.classify_intent(transcript_text, existing_entries)
        intent = result.get("intent", "add")

        if intent == "add":
            items = ai.normalise_add_items(result.get("items", []))
            return {"intent": "add", "items": items, "transcript": transcript_text}

        if intent == "edit":
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
                "transcript": transcript_text,
            }

        if intent == "delete":
            entry_id = result.get("entry_id")
            if entry_id is None:
                raise HTTPException(
                    status_code=422,
                    detail="Could not identify which entry to delete. Try being more specific.",
                )
            return {
                "intent": "delete",
                "entry_id": entry_id,
                "transcript": transcript_text,
            }

        raise HTTPException(status_code=422, detail=f"Unknown intent: {intent}")

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


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Serve the frontend — only when the ../frontend directory exists (local dev).
# In production the frontend is on GitHub Pages; this block is a no-op there.
# ---------------------------------------------------------------------------
_FRONTEND = Path(__file__).parent.parent / "frontend"
if _FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")
