# SenCity tool

SenCity shows how public spaces in Vienna may feel for one person, from their own sensory profile. It is the tool part of a master thesis final project (Advanced Computational Design and Architecture), by Elena Corio.

## Read first
1. `docs/tool-build-prompt.md`, the full brief. Its decisions are fixed: ask before changing any of them.
2. `docs/tool-design-notes.md`
3. `design/`, one PNG per screen of the design canvas.
4. `docs/architecture.md` and `docs/decisions.md`. Keep both up to date in the same commit as the change (brief §14).

## Hard rules
- **Street View:** never store image files. Store pano IDs, location, date and heading only, and fetch images on demand through the backend.
- **Secrets:** keys live only in `.env` (local) or Render env vars. Never commit `.env`, `runs/` or `data/`, and never put keys in the frontend.
- **Personal data:** no participant data in this repo or the app. Never log request bodies, profiles, answers or chat text.
- **AI models:** paid zero-data-retention endpoints only, never free endpoints.
- **Wording:**
  - The UI never says "persona": write "your profile" or "your predictions".
  - Every rating is "a prediction, not a reason".
  - The app does not name IAAC.
- **Costs:** ask before any run that calls a paid API beyond a small test (show the expected number of calls and the cost first).
- **Decisions:** when the brief leaves a choice open, pick the simplest option, say so, and log it in `docs/decisions.md`.
- **Language:** frontend in plain JavaScript (Vue 3, `<script setup>`), not TypeScript; backend in Python.
- **Styles:** every colour, font and size is a variable in `frontend/src/styles/style.css`. No hard-coded hex values or fonts in components or map code.
- **README:** `README.md` lists every script with its exact command. Update it when a script changes.
