# GuesstAImate
> Speak what you ate. Get an instant calorie estimate. No forms, no faff.

**Try it live:** https://djsaunders1997.github.io/GuesstAImate

<img src="screenshot.png" width="50%" alt="GuesstAImate screenshot" />

---

GuesstAImate is a voice-powered calorie tracker. Instead of searching a food database and weighing things, you just **speak one sentence** and it does the rest.

> *"I had scrambled eggs on toast and a coffee"* → instantly logged ✅

**A rough estimate you actually log beats a perfect one you don't.**

---

## Features

- 🎙️ **Voice logging** — tap record, say what you ate, done
- ✏️ **Manual entry** — hit `+`, with autocomplete from previous entries
- 🍗 **Macros** — protein, carbs, fat and fibre alongside calories
- 📅 **Day-by-day history** — flick back through previous days
- 📈 **Charts** — see intake build up through the day, with target lines
- ⚙️ **Editable targets** — set your own daily calorie and macro goals
- 💬 **Live transcription** — words appear on screen as you speak
- 📱 **Installable** — add to home screen on Android or iPhone (PWA)
- 💾 **No account needed** — everything lives in your browser

---

## Tech Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Vanilla JS + HTML5 Canvas | GitHub Pages |
| Backend | FastAPI (Python) | Azure Container Apps |
| Speech-to-Text | OpenAI Whisper-1 | OpenAI API |
| NLP / Macros | OpenAI GPT-4o-mini | OpenAI API |
| Storage | `localStorage` | Client-side |

For developer docs (file breakdown, PWA, local dev, deployment) → see [frontend/README.md](frontend/README.md).
