# GuesstAImate
> Speak what you ate. Get an instant calorie estimate. No forms, no faff.

🌐 **[Try it live →](https://djsaunders1997.github.io/GuesstAImate)**

<img src="screenshot.png" width="50%" alt="GuesstAImate screenshot" />

---

## What is it?

GuesstAImate is a voice-powered calorie tracker. Instead of opening an app, searching a food database, and entering exact gram weights, you just **speak one sentence** and it does the rest.

> *"I had scrambled eggs on toast and a coffee"* → instantly logged ✅

Apps like MyFitnessPal are great, but they cause tracking fatigue - constant weighing, searching, and form-filling. GuesstAImate is built on a different idea: **a rough estimate you actually log beats a perfect one you don't.**

---

## What can it do?

- 🎙️ **Voice logging** - tap record, say what you ate, done (60-second limit with live countdown)
- ✏️ **Manual entry** - prefer to type? Hit the `+` button
- 🍗 **Macros** - tracks protein, carbs, fat and fibre alongside calories
- 📅 **Day-by-day history** - flick back through previous days
- 📈 **Charts** - see your intake build up through the day, with target reference lines
- ⚙️ **Editable targets** - set your own daily calorie and macro goals
- � **Live transcription** - your words appear on screen as you speak (Chrome/Edge/Safari)
- �💾 **No account needed** - everything lives in your browser

---

## How does it work?

You tap a button and speak. Your voice is sent to an AI that:
1. Shows your words live on screen as you speak, via the browser's Web Speech API
2. Converts your speech to text with high accuracy (OpenAI Whisper) - this overwrites the live preview once done
3. Reads the text and estimates the calories and macros for everything you mentioned (GPT-4o-mini)
4. Sends the results back to your browser, where they're saved locally

The whole thing takes a few seconds. Nothing is stored on a server - your food log lives in your browser.

---

## Example

1. Open the [live site](https://djsaunders1997.github.io/GuesstAImate)
2. Tap **🎙️** and say: *"I had two eggs and a slice of toast for breakfast"*
3. The app logs **"Eggs and Toast - 240 kcal · P 14g · C 28g · F 10g · Fi 1g"**
4. Tap **📅** to browse previous days, or **Export CSV** to save your data

---
---

## Technical Details

### Architecture

```
User speaks → MediaRecorder (WebM) → POST /track (FastAPI on Azure)
→ Whisper-1 transcribes → GPT-4o-mini returns JSON array of food items
→ Response sent to browser → Rendered + saved to localStorage
```

### Tech Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Vanilla JS + HTML5 Canvas | GitHub Pages |
| Backend | FastAPI (Python) | Azure Container Apps |
| Speech-to-Text | OpenAI Whisper-1 | OpenAI API |
| NLP / Macros | OpenAI GPT-4o-mini | OpenAI API |
| Storage | `localStorage` (browser) | Client-side |

### Project Structure

```
GuesstAImate/
├── frontend/
│   ├── index.html          # Single-page app shell and markup
│   ├── main.js             # Entry point — config, DOM refs, event listeners, init
│   ├── storage.js          # localStorage read/write, addLog, deleteLog, CSV export
│   ├── recording.js        # Microphone capture, Whisper API call, live captions
│   ├── charts.js           # Canvas chart rendering and daily targets dialog
│   ├── render.js           # Log list rendering, day navigation, entry forms, utils
│   ├── styles.css          # Dark theme styles
│   └── Dockerfile          # Nginx image for local Docker testing
├── backend/
│   ├── main.py             # FastAPI app - /track and /health endpoints
│   ├── pyproject.toml      # Python dependencies (managed with uv)
│   ├── .env                # Local secrets (never committed)
│   └── Dockerfile
├── docker-compose.yml      # Runs frontend + backend together locally
└── .github/workflows/
    ├── ci_python.yml       # Ruff + mypy on backend changes
    └── static.yml          # Deploy frontend to GitHub Pages on push to main
```

### Local Development

```bash
export OPENAI_API_KEY=sk-...
docker compose up --build
```

| URL | Purpose |
|---|---|
| `http://localhost:8080` | Frontend (nginx) |
| `http://localhost:8000` | Backend API |
| `http://localhost:8000/docs` | Auto-generated API docs (Swagger) |
| `http://localhost:8000/health` | Health check |

The frontend auto-detects environment via `window.location.hostname` - `localhost` hits the local Docker backend, any other hostname hits the Azure Container App.

### Deployment

#### Backend → Azure Container Apps

Hosted in the `ContainerApps` resource group (UK West). Image published to GitHub Container Registry (`ghcr.io`).

```bash
# Build & push
docker buildx build --platform linux/amd64 \
  -t ghcr.io/djsaunders1997/guesstaimate:latest ./backend
docker push ghcr.io/djsaunders1997/guesstaimate:latest

# Update running container
az containerapp update \
  --name guesstaimate \
  --resource-group ContainerApps \
  --image ghcr.io/djsaunders1997/guesstaimate:latest
```

Live backend: `https://guesstaimate.jollyocean-6818c6e0.ukwest.azurecontainerapps.io`

> **Scale to Zero**: `--min-replicas 0` means no cost when idle. Cold-start is ~2–3 s.

#### Frontend → GitHub Pages

The `static.yml` workflow deploys `frontend/` automatically on every push to `main`.

### API Reference

#### `POST /track`
Accepts a multipart audio file, returns structured nutrition data.

**Request:** `multipart/form-data` with field `audio` (webm/ogg/wav)

**Response:**
```json
{
  "items": [
    {
      "food": "Scrambled eggs on toast",
      "calories": 320,
      "protein": 18,
      "carbs": 28,
      "fat": 12,
      "fibre": 2,
      "time_hint": "08:00"
    }
  ],
  "transcript": "I had scrambled eggs on toast for breakfast"
}
```

#### `GET /health`
Returns `{"status": "ok"}` - used by Azure to verify the container is running.

### Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key (`sk-...`) |

### CI / GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `ci_python.yml` | Push / PR on `backend/` | Runs `ruff` linter and `mypy` type-checker |
| `static.yml` | Push to `main` on `frontend/` | Deploys to GitHub Pages |


