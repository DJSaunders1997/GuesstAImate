import os
import json
import logging
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI

load_dotenv()  # loads .env from the current working directory

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


@app.on_event("startup")
async def startup_event():
    logger.info("=" * 50)
    logger.info("GuesstAImate API starting up")
    if not _api_key or _api_key.startswith("sk-your"):
        logger.warning(
            "OPENAI_API_KEY is not set or is still the placeholder — requests will fail!"
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


SYSTEM_PROMPT = (
    "You are a nutrition assistant. The user will describe what they ate in natural language. "
    "Estimate the total calories for everything mentioned. Use rough but reasonable estimates — "
    "consistency matters more than precision (e.g. ~100 kcal for a slice of bread). "
    'Return ONLY a valid JSON object in this exact format: {"food": "description", "calories": 500}. '
    "No markdown, no explanation — just the JSON object."
)

# File-extension map for common audio MIME types from browsers
_EXT_MAP = {
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Whisper API hard limit: 25 MB


@app.post("/track")
async def track(audio: UploadFile = File(...)):
    """
    Accepts an audio file, transcribes it with Whisper-1, then asks
    GPT-4o-mini to estimate calories. Returns JSON: {food, calories, transcript}.
    """
    data = await audio.read()

    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file exceeds 25 MB limit.")

    # Determine the correct file extension so Whisper can decode the stream
    content_type = (audio.content_type or "audio/webm").split(";")[0].strip()
    suffix = _EXT_MAP.get(content_type, ".webm")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        # Step 1: Speech → Text
        with open(tmp_path, "rb") as f:
            transcript_obj = client.audio.transcriptions.create(
                model="whisper-1", file=f
            )

        transcript_text = transcript_obj.text.strip()
        logger.info("Whisper transcript: %s", transcript_text)

        if not transcript_text:
            raise HTTPException(
                status_code=422, detail="Could not understand audio. Please try again."
            )

        # Step 2: Text → {food, calories}
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": transcript_text},
            ],
            temperature=0.3,
            max_tokens=150,
        )

        raw = completion.choices[0].message.content.strip()
        logger.info("GPT response: %s", raw)

        result = json.loads(raw)

        return {
            "food": str(result["food"]),
            "calories": int(result["calories"]),
            "transcript": transcript_text,
        }

    except json.JSONDecodeError:
        logger.error("Failed to parse GPT JSON: %s", locals().get("raw", "<not set>"))
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
# Visit http://localhost:8000 to open the app without any CORS issues.
# ---------------------------------------------------------------------------
_FRONTEND = Path(__file__).parent.parent / "frontend"
if _FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")
