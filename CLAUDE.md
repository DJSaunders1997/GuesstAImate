# GuesstAImate

Voice-powered calorie tracker PWA. Users speak what they ate and get an instant calorie + macro estimate via OpenAI APIs.

> "A rough estimate you actually log beats a perfect one you don't."

## Architecture

| Layer | Tech | Hosting |
|---|---|---|
| Frontend | Vanilla JS + HTML5 Canvas | GitHub Pages |
| Backend | FastAPI (Python) | Azure Container Apps |
| STT | OpenAI Whisper-1 | OpenAI API |
| NLP | OpenAI GPT-4o-mini | OpenAI API |
| Images | DALL-E 2 | OpenAI API |
| Storage | localStorage + Firestore | Client / Firebase |
| Auth | Firebase Auth (Google) | Firebase |

## Input Modes

- **Voice** — record → Whisper STT → GPT intent classification → add/edit/delete/multi
- **Photo** — camera/gallery → GPT-4o-mini vision → calorie estimate
- **Text** — typed description → GPT intent classification (same as voice, skips Whisper)
- **Manual** — form with autocomplete from previous entries

## Backend Files (`backend/`)

- **main.py** — FastAPI app, 4 endpoints: `POST /track` (voice), `POST /track-text` (typed), `POST /log-photo` (photo), `POST /image` (DALL-E thumbnail), `GET /health`. CORS wide-open. Request logging middleware.
- **ai_service.py** — `AIService` class wrapping all OpenAI calls: `transcribe_audio` (Whisper), `classify_intent` (GPT structured JSON), `normalise_add_items`, `generate_food_image` (DALL-E 2), `analyse_photo` (GPT-4o-mini vision).
- **models.py** — Pydantic models for all request/response schemas (FoodItem, TrackResponse, AddResponse, EditResponse, DeleteResponse, MultiResponse, etc.).
- **pyproject.toml** — uv-managed deps: fastapi, uvicorn, openai, python-dotenv. Dev: ruff, mypy.
- **Dockerfile** — Python 3.11-slim + uv, runs uvicorn on port 80.

## Frontend Files (`frontend/`)

- **index.html** — App shell: header (title, totals, auth, streak, targets/trends buttons), record section (mic/text/photo buttons, waveform canvas, status, transcript), logs section (day nav, log list, charts), trends panel, targets dialog, confirmation dialog.
- **storage.js** — Sole owner of localStorage. CRUD for logs, Firestore sync (push on every write, merge on sign-in), image cache (localStorage + Firestore global cache), CSV export, streak calculation, daily totals aggregation, meal-time inference.
- **render.js** — DOM rendering: log list grouped by meal (breakfast/lunch/dinner/snack), day navigation, inline edit/add forms with autocomplete, XSS escaping, confirmation dialogs.
- **charts.js** — All Canvas 2D charts: cumulative step charts (calories + 4 macros per day), daily targets management (open/close/save dialog), trends panel with bar chart, calorie bank, consistency heatmap, daily rhythm overlay.
- **track.js** — Backend API integration: builds FormData from audio chunks, POSTs to `/track` or `/track-text` or `/log-photo`, dispatches intent responses (add/edit/delete/multi), manages DALL-E image fetching + caching pipeline.
- **recording.js** — Microphone capture lifecycle: MediaRecorder, VAD (voice activity detection with auto-stop on 2.5s silence), live waveform visualiser, Web Speech API live captions.
- **auth.js** — Google sign-in via Firebase Auth popup. `onAuthStateChanged` triggers Firestore sync on sign-in; local data preserved on sign-out.
- **firebase.js** — Firebase app init with project config.
- **swipe.js** — Touch swipe gestures for day navigation with live drag, rubber-band resistance, spring-back animation. Keyboard arrow key navigation.
- **main.js** — Entry point: resolves backend URL (localhost vs Azure), warm-up health pings, DOM refs, event wiring, iOS install banner.
- **service-worker.js** — PWA offline caching: precaches static assets, cache-first for same-origin GETs, never intercepts API calls.
- **styles.css** — Dark theme CSS, ~1100 lines. CSS custom properties. Mobile-first, max-width 600px.
- **manifest.json** — PWA manifest for installability.

## CI/CD (`.github/workflows/`)

- **ci_python.yml** — On backend changes: ruff lint + mypy type-check.
- **deploy_backend.yml** — On main push to backend: Azure login (OIDC), build Docker image, push to GHCR, deploy to Azure Container Apps.
- **static.yml** — On main push to frontend: deploy Firestore rules, then deploy frontend to GitHub Pages.

## Firestore

- `users/{uid}` — per-user log sync (read/write only by owner)
- `images/{imageId}` — global food image cache (publicly readable/writable)

## Local Development

Always use `docker compose up --build` to run the app locally — never start the frontend on its own. The frontend needs the backend for all core features (voice logging, photo logging, text logging, image generation). Without it, health checks fail in a loop and nothing works.

```bash
export OPENAI_API_KEY=sk-...
docker compose up --build
# Frontend: http://localhost:8080
# Backend:  http://localhost:8000
# Swagger:  http://localhost:8000/docs
```

## Coding Conventions

- Keep changes minimal and focused — don't refactor unrelated code.
- No build step: don't introduce npm, bundlers, or CDN libraries without discussing trade-offs first.
- Backend uses `uv` + `ruff`. Run `uv run ruff check . --fix` after Python changes.
- Prefer editing existing files over creating new ones.
- Favour visible user impact over textbook best-practice polish. Before implementing, ask "will a real user of this app actually notice this?" If the answer is "only in theory," pick something with more visible impact instead.
- Favour features that reduce friction in the core loop (logging food) over polish on edge cases.

## Service Worker Rule

Whenever a new JS or CSS file is added to `frontend/`:
1. Add it to the `PRECACHE` array in `frontend/service-worker.js`.
2. Bump the `CACHE` version string (e.g. `guesstaimate-v4` → `guesstaimate-v5`).

## README Rule

Always update `README.md` after adding or changing a user-facing feature.
- Add new features to the Features list.
- Remove items from Future Improvements if they are now shipped.
