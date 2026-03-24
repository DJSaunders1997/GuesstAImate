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

- 🎙️ **Voice logging** — tap record, say what you ate, done. Stops automatically when you finish speaking
- 📊 **Live waveform** — see your audio visualised in real-time; colour shifts from green (speaking) to amber (silence detected, about to stop)
- 🗣️ **Voice editing** — say *"Change my cornish pasty to 400 calories"* or *"Remove the biscuits"* to correct or delete existing entries
- ✏️ **Manual entry** — hit `+`, with autocomplete from previous entries
- 🍗 **Macros** — protein, carbs, fat and fibre alongside calories
- 📅 **Day-by-day history** — flick back through previous days
- 📈 **Charts** — see intake build up through the day, with target lines
- ⚙️ **Editable targets** — set your own daily calorie and macro goals
- 💬 **Live transcription** — words appear on screen as you speak
- 🔥 **Streak tracking** — consecutive logging days shown in the header
- 📈 **Trends** — slide-up panel showing daily bar chart, calorie bank (cumulative deficit/surplus), consistency heatmap, and a **daily eating pattern** overlay (see when in the day you tend to eat) across 7, 14, or 30 days
- �📱 **Installable** — add to home screen on Android or iPhone (PWA)
- 💾 **No account needed** — everything lives in your browser's localStorage; sign in with Google to sync your full history across all devices. All historical data migrates automatically on first sign-in and is preserved locally even when signed out
- 🖼️ **Food thumbnails** — each log entry gets a DALL-E generated illustration in a consistent flat-lay icon style; images are cached locally so repeat foods (e.g. your daily flat white) never cost an extra API call
- 📷 **Photo logging** — tap the camera button, pick a photo of your meal, and get an instant calorie and macro estimate via GPT-4o vision (results are editable; photo estimates are less precise than voice)
- ✏️ **Text logging** — tap the pencil button to type a free-text meal description if voice or photo isn't convenient
- 🍽️ **Meal grouping** — log entries are automatically grouped into Breakfast, Lunch, Dinner, and Snack sections; each group shows a total calorie and macro summary and can be expanded or collapsed independently

---

## Tech Stack

| Layer | Technology | Hosting |
|---|---|---|
| Frontend | Vanilla JS + HTML5 Canvas | GitHub Pages |
| Backend | FastAPI (Python) | Azure Container Apps |
| Speech-to-Text | OpenAI Whisper-1 | OpenAI API |
| NLP / Macros | OpenAI GPT-4o-mini | OpenAI API |
| Storage | `localStorage` + Firestore | Client-side / Firebase |

For developer docs (file breakdown, PWA, local dev, deployment) → see [frontend/README.md](frontend/README.md).

---

## Potential Future Improvements

1. **Barcode scanner** — point camera at a product barcode to auto-fill nutritional info without speaking
2. **Meal templates / favourites** — save a common meal (e.g. "my usual lunch") and log it in one tap
3. **Water intake logging** — track hydration alongside food, with a daily target
4. **Recipe builder** — enter ingredients to get a total macro breakdown for a homemade dish
5. **Notifications / reminders** — push notifications to prompt logging at meal times (PWA supports this)
