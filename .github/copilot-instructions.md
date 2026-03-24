# GuesstAImate — Copilot Instructions

## README rule
**Always update `README.md` after adding or changing a user-facing feature.**
- Add new features to the Features list (keep it bullet-point, emoji-prefixed, one line each).
- Remove items from Future Improvements if they are now shipped.
- Do not create a separate changelog file; the README is the source of truth.

## Project context
- **Frontend**: plain Vanilla JS, no bundler, served as a GitHub Pages static site at `/GuesstAImate/`.
- **Backend**: FastAPI + Python, deployed to Azure Container Apps. AI logic lives in `backend/ai_service.py` (`AIService` class); routing only in `backend/main.py`.
- **Storage**: `localStorage` only — no user accounts.
- **Style**: dark theme, CSS variables in `:root`. Primary green `#22c55e`, danger red `#ef4444`, warn amber `#f59e0b`, muted `#94a3b8`.

## Service worker rule
**Whenever a new JS or CSS file is added to `frontend/`, ALWAYS:**
1. Add it to the `PRECACHE` array in `frontend/service-worker.js`.
2. Bump the `CACHE` version string (e.g. `guesstaimate-v4` → `guesstaimate-v5`).

Without this, users with the PWA installed will get a 404 for the new file until the old service worker expires.

## Coding conventions
- Keep changes minimal and focused — don't refactor unrelated code.
- No build step: don't introduce npm, bundlers, or CDN libraries without discussing trade-offs first.
- Backend uses `uv` + `ruff`. Run `uv run ruff check . --fix` after Python changes.
- Prefer editing existing files over creating new ones.
- Don't add docstrings or comments to code you didn't write.
