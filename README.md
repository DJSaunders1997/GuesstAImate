# GuesstAImate
> Voice-powered AI calorie tracker — speak what you ate, get an instant estimate.

## Philosophy: Consistency Over Perfection

this is an easy wasy to track your callories to help be healthy and weightloss.

Instread of having to open something like myfitnesspal, having to go thorugh lots of forms and inupts and entering the exact gram amount we can use natural langauge instead!

Apps like MyFitnessPal cause tracking fatigue because of constant weighing, searching, and form-filling. GuesstAImate removes all of that. You speak one natural sentence — *"I had a bowl of pasta and a light salad"* — and the AI logs a rough-but-reasonable estimate immediately. The goal is to build a sustainable daily habit, not to achieve laboratory-grade accuracy.

---

## How It Works

```
User speaks → MediaRecorder captures audio → POST to Azure FastAPI
→ Whisper-1 transcribes speech → GPT-4o-mini estimates calories
→ JSON response → Saved to localStorage → Shown instantly on screen
```

---

## Tech Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Vanilla JS + HTML5 | GitHub Pages |
| Backend | FastAPI (Python) | Azure Container Apps |
| Speech-to-Text | OpenAI Whisper-1 | OpenAI API |
| NLP / Calories | OpenAI GPT-4o-mini | OpenAI API |
| Storage | `localStorage` (browser) | Client-side |

---

## Project Structure

```
GuesstAImate/
├── frontend/
│   ├── index.html          # Single-page app (deploy to GitHub Pages)
│   └── Dockerfile          # Nginx image for local Docker testing
├── backend/
│   ├── main.py             # FastAPI app
│   ├── pyproject.toml      # Python dependencies (uv)
│   ├── .env                # Local secrets (never committed)
│   └── Dockerfile          # Container definition
├── docker-compose.yml      # Runs frontend + backend together
├── .github/
│   └── workflows/
│       ├── ci_python.yml   # Lint + type-check on backend changes
│       └── static.yml      # Deploy frontend to GitHub Pages
└── README.md
```

---

## Local Development

```bash
export OPENAI_API_KEY=sk-...
docker compose up --build
```

| URL | Purpose |
|---|---|
| `http://localhost:8080` | Frontend (nginx) |
| `http://localhost:8000` | Backend API |
| `http://localhost:8000/docs` | API docs |
| `http://localhost:8000/health` | Health check |

---

## CI / GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `ci_python.yml` | Push / PR touching `backend/` | Runs `ruff` linter and `mypy` type-checker |
| `static.yml` | Push to `main` touching `frontend/` | Deploys `frontend/` to GitHub Pages |

---

## Deployment

### Backend → Azure Container Apps

```bash
# 1. Build & push the container
az acr build --registry <your-registry> --image guesstaimate-api:latest ./backend

# 2. Create a Container App (scale to zero to save money)
az containerapp create \
  --name guesstaimate-api \
  --resource-group <your-rg> \
  --image <your-registry>.azurecr.io/guesstaimate-api:latest \
  --min-replicas 0 \
  --max-replicas 3 \
  --target-port 80 \
  --ingress external \
  --secrets openai-key=<your-openai-key> \
  --env-vars OPENAI_API_KEY=secretref:openai-key \
             ALLOWED_ORIGINS=https://<your-github-username>.github.io
```

> **Scale to Zero**: Setting `--min-replicas 0` means the app costs nothing when idle. It cold-starts on the first request (~2–3 seconds).

### Frontend → GitHub Pages

1. Push `frontend/index.html` to a GitHub repo.
2. Go to **Settings → Pages → Source** and set it to the branch/folder containing `index.html`.
3. Update `BACKEND_URL` in `index.html` to your Azure Container App URL before pushing.

---

## Environment Variables (Backend)

| Variable | Description | Example |
|---|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key | `sk-...` |

---

## API Reference

### `POST /track`
Accepts a multipart audio file, returns a calorie estimate.

**Request:** `multipart/form-data` with field `audio` (webm/ogg/wav)

**Response:**
```json
{
  "food": "Pasta and light salad",
  "calories": 650,
  "transcript": "I had a big bowl of pasta and a light salad"
}
```

### `GET /health`
Returns `{"status": "ok"}` — used to verify the container is running.

---

## Example User Flow

1. User opens `https://yourusername.github.io/GuesstAImate`
2. Taps the large **🎙️ Record** button and says: *"I had two eggs and a slice of toast"*
3. App shows **"Processing…"** while Azure processes the audio
4. App instantly adds **"Eggs and Toast — 240 kcal"** to the day's log
5. Data is saved in the browser (`localStorage`) — no account needed
6. At the end of the week, user clicks **Export CSV** to save to a spreadsheet

