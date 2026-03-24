"""ai_service.py — OpenAI integration for GuesstAImate.

All AI logic is encapsulated in AIService. Private methods handle prompt
construction and raw LLM calls; public methods form the external API used
by main.py.
"""

import json
import logging

from openai import OpenAI

logger = logging.getLogger(__name__)


EXT_MAP: dict[str, str] = {
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # Whisper API hard limit: 25 MB


_PHOTO_SYSTEM_PROMPT = (
    "You are a nutrition assistant. The user has sent a photo of food they ate. "
    "Identify all visible food items and estimate their calories, protein, carbs, fat, and fibre. "
    "Use standard home or restaurant portion sizes unless the image clearly shows otherwise. "
    "If the photo is unclear or contains no food, return an empty items list. "
    'Return JSON only: {"items": [{"food": "desc", "calories": 300, "protein": 10, "carbs": 40, "fat": 8, "fibre": 3}]}\n'
    "No markdown, no explanation — just the JSON object."
)


_SYSTEM_PROMPT = (
    "You are a nutrition assistant managing a food log. "
    "The user speaks naturally to either:\n"
    "  1. Log new food they ate → intent 'add'\n"
    "  2. Correct an existing log entry → intent 'edit'\n"
    "  3. Remove an existing log entry → intent 'delete'\n"
    "  4. Do multiple of the above at once → intent 'multi'\n\n"
    "Classify intent from natural language cues:\n"
    "  'add': 'I had', 'I ate', 'I just had', 'I drank', describing food without reference to corrections.\n"
    "  'edit': 'change', 'correct', 'actually', 'it was', 'not X', 'should be', 'update', 'fix', 'wrong', 'put X in as Y'.\n"
    "  'delete': 'remove', 'delete', 'scratch that', 'ignore the', 'take off', 'get rid of'.\n"
    "  'multi': the message clearly contains two or more distinct operations of any type combined in one utterance.\n\n"
    "For 'add': split into individual items, estimate calories/protein/carbs/fat/fibre for each. "
    "Extract time references (HH:MM 24h). Map meal names: "
    "breakfast=07:30, brunch=10:00, lunch=12:30, afternoon tea=15:30, dinner=18:30, supper=19:30. Null if no time. "
    "Also include a 'meal' field for each item: one of 'breakfast', 'lunch', 'dinner', 'snack'. "
    "Infer from explicit language ('I had a snack', 'for breakfast') or time context "
    "(05:00-10:30=breakfast, 10:30-14:00=lunch, 14:00-17:30=snack, 17:30-22:00=dinner, else snack). "
    'Return: {"intent": "add", "items": [{"food": "desc", "calories": 300, "protein": 10, "carbs": 40, "fat": 8, "fibre": 3, "time": "09:00", "meal": "breakfast"}]}\n\n'
    "For 'edit': match the user's description to an existing log entry by name. "
    "Return only the fields the user mentioned changing. "
    "Valid update fields: calories (number), protein (number), carbs (number), fat (number), fibre (number), food (string). "
    'Return: {"intent": "edit", "entry_id": <id>, "updates": {"calories": 400}}\n\n'
    "For 'delete': match the user's description to an existing log entry. "
    'Return: {"intent": "delete", "entry_id": <id>}\n\n'
    "For 'multi': return each distinct operation as a separate action object inside an 'actions' array. "
    "Each action must be a fully-formed add/edit/delete object (same format as above, including the 'intent' field). "
    'Return: {"intent": "multi", "actions": [{"intent": "delete", "entry_id": <id>}, {"intent": "add", "items": [...]}]}\n\n'
    "No markdown, no explanation — just the JSON object."
)



class AIService:
    """Wraps all OpenAI calls for GuesstAImate.

    Public API (called by main.py):
        transcribe_audio     — Whisper STT
        classify_intent      — GPT intent detection and structured extraction
        normalise_add_items  — Schema coercion for 'add' payloads

    Private helpers:
        _build_user_message  — Compose the user-turn text with log context
        _call_llm            — Send the chat completion and parse JSON
    """

    def __init__(self, client: OpenAI) -> None:
        self._client = client


    def _build_user_message(self, transcript: str, existing_entries: list[dict]) -> str:
        """Prepend today's log entries as context for edit/delete requests."""
        if not existing_entries:
            return transcript
        entries_json = json.dumps(existing_entries, ensure_ascii=False)
        return f"Existing log entries: {entries_json}\n\nUser said: {transcript}"

    def _call_llm(self, user_message: str) -> dict:
        """Call GPT-4o-mini with the composed user message and return parsed JSON."""
        completion = self._client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_tokens=1000,
        )
        raw = completion.choices[0].message.content.strip()
        logger.info("GPT response: %s", raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Failed to parse GPT JSON: %s", raw)
            raise


    def transcribe_audio(self, tmp_path: str) -> str:
        """Transcribe an audio file via Whisper-1 and return the transcript text."""
        with open(tmp_path, "rb") as f:
            result = self._client.audio.transcriptions.create(model="whisper-1", file=f)
        return result.text.strip()

    def classify_intent(self, transcript: str, existing_entries: list[dict]) -> dict:
        """Classify the user's intent and extract structured data."""
        user_message = self._build_user_message(transcript, existing_entries)
        return self._call_llm(user_message)

    def normalise_add_items(self, items_raw: list[dict]) -> list[dict]:
        """Coerce a raw GPT items list into the standard per-item schema."""
        return [
            {
                "food": str(item["food"]),
                "calories": int(item["calories"]),
                "protein": float(item.get("protein") or 0),
                "carbs": float(item.get("carbs") or 0),
                "fat": float(item.get("fat") or 0),
                "fibre": float(item.get("fibre") or 0),
                "time_hint": item.get("time"),
                "meal": item.get("meal"),
            }
            for item in items_raw
        ]

    def generate_food_image(self, food_name: str) -> str:
        """Generate a DALL-E 2 image for the given food and return a base64 PNG data URL."""
        prompt = (
            f"A flat-lay food illustration of {food_name}. "
            "Minimal flat design, soft pastel colours, clean dark background, "
            "simple bold shapes, no text, no shadows, icon style."
        )
        response = self._client.images.generate(
            model="dall-e-2",
            prompt=prompt,
            n=1,
            size="256x256",
            response_format="b64_json",
        )
        b64 = response.data[0].b64_json
        return f"data:image/png;base64,{b64}"

    def analyse_photo(self, image_b64: str) -> dict:
        """Send a food photo to GPT-4o-mini vision and return estimated items."""
        completion = self._client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _PHOTO_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "low",
                            },
                        },
                        {"type": "text", "text": "What food is in this image? Estimate the nutritional info."},
                    ],
                },
            ],
            temperature=0.3,
            max_tokens=800,
        )
        raw = completion.choices[0].message.content.strip()
        logger.info("Photo GPT response: %s", raw)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Failed to parse photo GPT JSON: %s", raw)
            raise
