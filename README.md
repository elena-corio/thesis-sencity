# SenCity

SenCity shows how public spaces may feel for one person, from their own sensory profile. It is the tool part of Elena Corio's master thesis (Advanced Computational Design and Architecture). The brief is in `docs/tool-build-prompt.md`, the architecture in `docs/architecture.md`, and the decisions in `docs/decisions.md`.

## Setup

Requires Python 3.11 or newer. On Windows, use Git Bash (the commands below) or adapt the paths for PowerShell.

```bash
py -3.11 -m venv .venv                       # once, at the repo root
.venv/Scripts/python -m pip install -r backend/requirements.txt
cp .env.example .env                         # then fill in the key
```

**Keys in `.env`** (repo root, never committed):

| Name | What |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform key with **Street View Static API** enabled: the app's photos with `PHOTO_SOURCE=streetview` (metadata free; each image shown or rated is a paid call, at most `streetview.daily_image_cap` a day), and the step-1 tool and its review page (`tool.fetch_photos`, `tool.review_server`). Backend only: never name it `VITE_*`, because Vite would put it in the browser bundle. |
| `MAPILLARY_ACCESS_TOKEN` | Mapillary token (free): the app's photos with `PHOTO_SOURCE=mapillary`, and with `streetview` the photos where Street View has none (parks, paths). Backend only: the browser gets only the public thumbnail URLs. |
| `PHOTO_SOURCE` | Not a secret. Where the app's photos come from, for finding, rating and showing them: `streetview` (the default, the local prototype only, as the study's photos) or `mapillary` (any public version). Read by the API and by `npm run build`, which refuses `streetview`; set `PHOTO_SOURCE=mapillary` for both on Render (the API refuses `streetview` there too). Changing it finds the photos of an area or route again (it is part of their cache keys). |
| `INFRARED_API_KEY` | Infrared.city key for thermal comfort. Each new area or route and season/time is billed: 10 tokens per 512 m tile (a circle up to ~250 m is usually 1 tile, 500 m up to 4; a route about 4–6, at most 8). Backend only. |
| `OPENROUTER_API_KEY` | OpenRouter key for the Senses predictions. Each new photo takes two paid calls (presence, then rating), sent to the zero-retention endpoint pinned in `model/app_v9/model.json`. Backend only: never name it `VITE_*`. |

All thresholds are in `config/tool.yaml`.

## Scripts

Run every script from `backend/`:

```bash
cd backend
```

### `tool.fetch_photos`: photo candidates for one circle

Takes a circle around any point. Gets the walkable OpenStreetMap ways, parks and squares inside it. Cuts the streets into ~50 m segments where they branch or end, and merges leftover pieces under 10 m into a neighbour. Asks Street View for the photos along each segment, and keeps up to 3 per segment with the rule in brief §4. Streets get official Google imagery only. When the nearest photo is a contributor photo, it retries from nearby points with a smaller radius. Parks, squares and pedestrian areas fall back to contributor photos only when no official photo is found, and those photos are flagged. Unnamed areas mostly enclosed by buildings are skipped as courtyards. Photos taken inside a building footprint are rejected as indoor. By default it uses **only free calls**: Overpass and Street View metadata. A 200 m circle in the old town took about 1,200 metadata calls.

```bash
../.venv/Scripts/python -m tool.fetch_photos --lat 48.2085 --lon 16.3721 --radius 100
```

To get the coordinates, right-click the place in Google Maps and copy the first line.

| Option | What it does |
|---|---|
| `--lat`, `--lon` | Centre of the circle |
| `--radius` | Radius in metres, 50–500. Above 100 m it needs `--yes` while we are testing. |
| `--check-images` | Adds the 70% sharp/unblocked check. Without `--yes` it only prints how many image calls it would need and their cost, then stops. |
| `--yes` | Confirms a radius above 100 m, or the image calls of `--check-images` |
| `--refresh` | Asks OSM and Street View again instead of reusing this run's cached answers |

Example of the paid check, after reading the estimate:

```bash
../.venv/Scripts/python -m tool.fetch_photos --lat 48.2085 --lon 16.3721 --radius 100 --check-images        # estimate only
../.venv/Scripts/python -m tool.fetch_photos --lat 48.2085 --lon 16.3721 --radius 100 --check-images --yes  # fetch
```

**Outputs** go in `runs/photos/<date>_<lat>_<lon>_r<radius>/` (not committed):

| File | Contents |
|---|---|
| `segments.geojson` | One feature per street segment or park/square, with its name, OSM type, length or area, the chosen pano IDs, headings, dates and photo type, and the number of contributor photos kept |
| `photos.csv` | One row per candidate (pano × heading × segment): pano ID, segment, lat/lon, date, heading, kept or rejected, the reason, rank, distances, `photo_type` (official or contributor), and the sharp share if the image check ran |
| `review.html` | The review page. Open it through `tool.review_server`, see below. |
| `run.log` | What happened, the counts, and the number of metadata and image calls with the estimated cost |
| `run.json` | The same counts as JSON |
| `osm.json`, `buildings.json`, `metadata.json` | Cached answers (streets and areas, building footprints for the indoor test, photo metadata), so a re-run in the same folder makes no new calls. Pano IDs, location, date and copyright only: no images. |

**Rejection reasons:**

| Reason | Meaning |
|---|---|
| `contributor photo` | Not official Google imagery (a photosphere uploaded by someone). Streets use official imagery only. |
| `contributor photo, official found` | Parks, squares and pedestrian areas can fall back to contributor photos, but only when no official photo passes the filters |
| `indoor` | Taken inside an OSM building footprint (shrunk by 1.5 m), e.g. a building passage or a shop |
| `no date` | The metadata has no capture date |
| `too far from segment` | More than 15 m from the line |
| `too old` | More than 5 years old, while a newer photo exists for the segment |
| `same spot` | Within 10 m of a kept photo, or the other heading of a kept pano |
| `segment full` | 3 photos already kept |
| `70% rule` | The image check failed |

### `tool.osm_local`: a local copy of Vienna's streets

Downloads OpenStreetMap's streets, paths, parks, squares and buildings for Vienna into `data/osm/vienna/` (not committed), so a new area or route does not wait for the public Overpass server. Free, about one to two hours once: 112 tiles, the centre first, with a pause between them. It resumes where it stopped, so run it again after an interruption. No photos are looked up and nothing is rated.

```bash
../.venv/Scripts/python -m tool.osm_local             # what is missing
../.venv/Scripts/python -m tool.osm_local --limit 2   # only two tiles, to try it
../.venv/Scripts/python -m tool.osm_local --refresh   # everything again, for newer OpenStreetMap data
```

The API reads a tile as soon as it exists; no restart is needed. Outside Vienna, or where a tile is missing, it asks Overpass as before. Settings are in `osm_local` in `config/tool.yaml`.

### `tool.review_server`: check the photos

```bash
../.venv/Scripts/python -m tool.review_server                       # the latest run
../.venv/Scripts/python -m tool.review_server --run 2026-11-01_48.2085_16.3721_r100
```

Open http://127.0.0.1:8765/ and stop the server with Ctrl+C.

Two tabs, never side by side (Google's EEA terms forbid Street View Static images next to a map). The server rebuilds the page from the current template when it starts, so older runs get the tabs too.
- **Photos:** one card per segment with its kept photos, and the date, heading, rank and distances under each. Rejected photos are in a collapsed "Rejected" section, grouped by reason. They load only when you click "Load photo".
- **Map:** the circle (dashed), the segments (cyan with a kept photo, grey without), parks and squares, and the photo points (dark = kept). Click a segment to go to its photos in the Photos tab.
- **Keep / Reject** on any photo saves your verdict, and the optional note, to `review_notes.csv` in the run folder. Click again to clear it. Use these notes to tune the filter thresholds.
- **Costs:** every photo shown is one paid Street View image call. The page shows the total for the kept photos, and the server prints and logs each call. Images are never saved or cached, so reloading the page fetches them again.

### `app`: the SenCity API

The backend the app talks to. `npm run dev` starts it for you (see Frontend); you only need the commands below to run it on its own.

| Endpoint | What it does |
|---|---|
| `POST /api/search` | Address and place search through Photon (komoot, OpenStreetMap data, no key). The text travels in the request body and is never logged. |
| `POST /api/area` | Street segments and their photos for one circle `{lat, lon, radius}`: the OpenStreetMap streets, parks and squares, then the photo lookups per street (free metadata). With `PHOTO_SOURCE=streetview`, up to 3 Street View photos per street or place by the step-1 rule (official imagery on streets, newest first, different spots), and the Mapillary photo where Street View has none; with `mapillary`, one Mapillary photo per street (the rules of `/api/mapillary/along`, a street either way along it, a park or square in any direction). It streams its progress, and the result is cached in `runs/areas/<key>.json` (segments and photo metadata only, no images). A cached area answers at once. If the photo lookups fail, the steps already done are kept next to it (`<key>.osm.json`, `<key>.photos.json`), so Try again goes on from there; they are removed once the area completes. |
| `POST /api/routes` | Two walking routes between two points `{start, end, limits, season, time}`: the shortest, and the easiest at most 25% longer. It streams progress: streets, photos along the way (free metadata; a street the ways walk gets photos facing the way it is walked: with Street View one every 10 to 20 m, with Mapillary one), thermal comfort along a narrow corridor (billed, cached), then the two ways. In the answer every photo faces the way its route walks the street (Street View and panoramas turned to the route's bearing a few metres ahead, so the street ahead at a turn; flat photos only within 60° of it, with `offset_deg`); a street with none says "No photo"; a street both routes walk faces A's way. Settings in `walk_photos` of `config/tool.yaml`. Start and end travel in the body and are never logged or stored. |
| `GET /api/photo/{pano_id}?heading=…` | One Street View image of a loaded area or route (any other pano or heading: 404), fetched when a card, the enlarged photo or the walk shows it, passed through in memory and never stored (`Cache-Control: no-store`, so the browser does not keep it either). Each is a paid call, counted against `streetview.daily_image_cap` for the whole server (`runs/streetview/usage.json`, the date and the count only); above it, 429. |
| `POST /api/senses/rate` | The model's general predictions for a list of photos `{photos: [{id, heading}]}` (Mapillary image IDs, or `sv:<pano ID>`): the photos the app shows, streamed as they finish. Cached photos answer at once and cost nothing; the others are fetched in memory (Street View: the 640 × 640 crop the app shows, a paid image under the daily cap; Mapillary: a panorama rendered as the 640 × 640, 90° view at its heading) and rated, 4 at a time, up to 250 per run: first the presence call (which of the 20 elements are clearly visible, and how many people: Crowds at 8 or more; cached per photo), then the rating on that list. A flat photo is rated only at its own heading. See "Senses mode" below. |

Access logs are off, and request bodies are never logged.

```bash
cd backend
../.venv/Scripts/python -m app            # http://127.0.0.1:8000, Ctrl+C to stop
../.venv/Scripts/python -m app --reload   # restarts when the code changes
```

Settings are in the `api` section of `config/tool.yaml`: allowed browser origins; for search, the Photon URL, text length, number of results and rate limit; for areas, the cache folder and the limit of new areas per IP per hour. The Mapillary rules, lookups at a time and the panorama view for the model are in the `mapillary` section; the Street View crop, price, daily cap and walk spacing in `streetview`, its selection rule in `candidates` and `selection`, and the image rate limit per IP in `api.photo`. The keys are read from `.env` on the server only.

After the photos, `/api/area` runs **thermal comfort** for the circle (Infrared.city, season and time from the request, default summer 15:00) and sends the feels-like °C per street. It is billed per run and cached in `runs/thermal/` per area and window, so the same area, season and time is never paid for twice. A run that would bill more than `thermal.max_jobs` jobs is refused before anything is sent. Settings are in the `thermal` section of `config/tool.yaml`; the key `INFRARED_API_KEY` is read from `.env` on the server only. Without the key the photos still load and the app says thermal comfort is not set up.

A new area takes about a minute: most of it is the public Overpass server (OpenStreetMap), which is often busy. The photo lookups run in parallel and take a few seconds.

A new **route** costs one thermal run on a corridor around its possible ways: about 4–6 tiles (40–60 tokens), at most `routes.max_jobs` (8, so 80 tokens), checked with the free preview before anything is billed. A new season or time for that route is another run; the same route and window, in either direction, is never paid for twice. It takes about a minute before thermal (Overpass, then the photo lookups per corridor street), plus the simulation. Corridors are cached in `runs/routes/`, with no start or end in them. Settings are in the `routes` section of `config/tool.yaml`.

**Senses mode (general prediction, no profile).** To try it: add `OPENROUTER_API_KEY` to `.env`, run `npm run dev` in `frontend/`, and analyse an area (Senses is the layer the app opens on). Every photo is rated in the background, nearest first, and streets take their colours as ratings arrive. When it ends, the most comfortable places appear as numbered pins and in a list. A route is rated too, once its two ways are ready. Clicking a place opens its detail with no new call. With your profile the prediction is the study's V2; `senses.formula_mode` in `config/tool.yaml` (none, xhat or f) would add the study's formula paragraph, but the app has no others' averages or fitted coefficients, so it always falls back to none.

**Costs.** Each new photo takes two paid model calls: the presence call and the rating call (with V0 one call cost about $0.00076, the mean of 1,630 calls; the v9 calls are not measured yet). A photo whose presence is cached takes only the rating call. Mapillary photos are free. With `PHOTO_SOURCE=streetview` each new photo rated is also one Street View image (about $0.007 at list price, 10,000 a month free; a default 200 m area has about 236 photos, about $1.65), and so is every photo shown on a card, enlarged or in the walk, each time (nothing is kept); a walked street has one photo every 10 to 20 m. At most `streetview.daily_image_cap` (1000) images a day for the whole server. In `npm run dev` the cost line adds them ("$0.05 model · $0.84 Street View (120 images)"). A default 200 m area around Stephansplatz has 126 places, 115 with a Mapillary photo: 226 calls, about $0.17 at the V0 price. A walk rates its stretches' own photos where they differ from their streets' (at most two calls per stretch). A run rates at most 250 new photos; above that the app asks first, with the estimated cost of the rest. A photo already rated costs nothing.

Everything about the model comes from `model/app_v9/` (exported from the thesis repo), read on every request. Every file is checked against its sha256 in the folder's `MANIFEST.md` first; if one differs, nothing is sent. To change the setting, replace that folder: no code change or restart. `.gitattributes` keeps Git from changing line endings in `model/`, which would break the hash check. The previous export is kept in `model/archive/app_v0/` and is not read. The reasoning order and any model, endpoint or image setting are picked up. If a file is missing or does not parse, or the export breaks a privacy rule (`zdr`, `data_collection`, `allow_fallbacks`, a free endpoint), the app shows which file is wrong and sends nothing. An `input` other than `photo` is refused too: the export has no describer model or prompt to build it from.

Results are cached in `runs/senses/predictions.json` (not committed) per photo (Mapillary image ID, or `sv:` and the pano ID), heading, model and the MANIFEST's commit, so a new model or export starts fresh. It holds only the JSON output, the model ID, latency and cost: never an image. Ratings made before 2026-11-11 from Street View photos (keys with no source) stay in the file marked `stale` and are never used. Other settings (OpenRouter URL, timeout, how many at a time, the cap, the limit per IP) are in `api.senses` in `config/tool.yaml`.

### Tests

```bash
cd ..   # repo root
.venv/Scripts/python -m pytest backend/tests --rootdir backend
.venv/Scripts/python -m pytest backend/tests/test_senses.py --rootdir backend   # only the Senses request and replies
.venv/Scripts/python -m pytest backend/tests/test_profile.py --rootdir backend  # only your sensory profile (text, checks, V0/V2)
```

**Chat intent accuracy (paid).** The chat parser is checked on two fixed sets of requests. Each request is one model call (about $0.00075):

```bash
cd backend
../.venv/Scripts/python -m app.chat_eval dev     # the development set (28 requests, about $0.023): the only one used to tune config/chat_prompt.txt
../.venv/Scripts/python -m app.chat_eval test    # the frozen test set (30 requests, about $0.024): the accuracy reported
../.venv/Scripts/python -m app.chat_eval seasons # the frozen set for "which season is best?" (10 requests, about $0.008)
CHAT_LIVE=1 ../.venv/Scripts/python -m pytest tests/test_chat_live.py -s   # the same test set as a test: passes at 90% (27/30)
```

Without `CHAT_LIVE=1` the live test is skipped, so the normal test run makes no paid call. The test set (`backend/tests/fixtures/chat_intents_test.json`) is frozen: `test_chat.py` checks its sha256.

These test segment splitting, the selection rule, the route finder, and the API: search (with a fake Photon), areas (from a fixed cached sample), routes (with made-up streets and temperatures), photos (the key never in the answer, nothing written to disk), and Senses (the hash check of `model/app_v9/`, the presence and rating requests built from it, the empty list, validated replies, the retry, both caches, the stale marks, the cap, at most 4 at a time). They make no API calls.

## Frontend

The app: the map start screen, address search, the two-click area selection (boards Flow 1, 1b, 1c) and Routes (boards Routes 1–4), in dark and light. Requires Node.js 20 or newer.

```bash
cd frontend
npm install                     # once
npx playwright install chromium # once, for the screen checks
npm run dev                     # starts the API too, and opens http://localhost:5173/area
```

`npm run dev` also starts the SenCity API (`python -m app` in `backend/`, port 8000) and stops it when you stop the dev server; the terminal shows `[api] started`. If the API already runs on port 8000, it is reused. It needs the Python setup above (`.venv` at the repo root). Vite forwards `/api` to it, so the browser talks to one address only. Without the API, the map still works, and search says "Search is not available right now."

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run dev` | Starts the API and the app, and opens http://localhost:5173/area in your browser; reloads on every change |
| `PHOTO_SOURCE=mapillary npm run build` | Builds the static site into `frontend/dist/` (for Render). Fails with `PHOTO_SOURCE=streetview` or unset (the default is Street View, for the local prototype only) |
| `npm run preview` | Serves the built site locally |
| `npm test` | Unit tests for the radius maths, thermal score and route stretches (Vitest), no browser needed |
| `npm run test:e2e` | Playwright: step screenshots; the fit-every-screen check at all sizes, both orientations, dark and light, 200% zoom and larger text, with the place card and the enlarged photo open; the keyboard walk-through; search; streets and photos; Routes, with its own fit check; your sensory profile (onboarding, edit, download, delete, import, general and personal ratings). The API is mocked (a fixed Stephansplatz area in `e2e/fixtures/`, made-up routes, a placeholder image), so no Mapillary, Street View, Overpass, Infrared.city or OpenRouter calls are made; one walk check uses made-up Street View photos, several per street. Starts the dev server itself if it is not running. |

**Using the map:**
- Search: type at least 3 letters of a street, address or place, then pick a suggestion with the mouse, or with the arrow keys and Enter. The map moves there. Esc closes the list, a second Esc clears the text.
- Click to place the centre of your area, move to set the radius, then click again to fix it.
- Drag the edge to adjust. Esc or a right-click starts again.
- **Analyse this area** loads the streets, then their photos (about a minute for a new area). The loading card shows the progress; streets light up as their photos are found. Cancel goes back to the circle.
- Streets with photos are light teal with a soft glow; streets without a photo are thin and dim. Click a street to open its card: up to 3 photos with arrows, date and direction ("Looking north-east, July 2024"). Click the photo to enlarge it; arrow keys switch photos, Esc goes back. A street without a photo offers "Go to the nearest street with photos".
- Photos load when you open a street; a Mapillary thumbnail (free) also when you rest the pointer on it, a Street View image (paid) never before it is shown. The area itself loads no image.
- Keyboard: after the area has loaded, Tab from the map goes through its streets in reading order (a dashed ring shows which); Enter opens the card, Esc closes it.
- Keyboard: Tab to the map, then Enter places the centre at the map centre, the arrow keys change the radius in 10 m steps, and Enter fixes it.
- Phone: tap the centre, then drag (the circle follows your finger; lift to fix it) or tap a second point. Press and drag also works with a mouse.

**Using Routes:**
- Open the **Routes** tab. Click where you start, then where you want to go, or type either place in the fields on the left. Points must be 50 m to 1.5 km apart. Choose the season and time first if you like.
- With both points set, the "This walk" card shows start, end and the straight-line distance. Nothing is fetched or billed until you press **Analyse this walk**; **Start again** or Esc clears the points. Thermal comes last and is the billed step, so **Cancel** still stops it while the streets and photos load, and goes back to this card.
- The two ways appear when they are ready: A (the shortest, continuous) and B (the easiest at most a quarter longer, dashed), coloured by Thermal. Senses and Overall follow with the rating.
- The A and B buttons show or hide a route. Hovering one, or a section of a bar, finds it on the map.
- Click a street on the map, or a section of a bar, to open its card, as in Area. The arrow keys or the buttons go to the previous or next street of that route; Esc goes back.
- A new season or time asks again (billed unless cached). The ways on the map stay until the new ones arrive.
- Keyboard: Tab to the map, Enter sets the start at the map centre, move the map with the arrow keys, and Enter sets the end; Enter again on **Analyse this walk** starts it. Tab reaches each route's bar once, and the arrow keys go along it. Phone: tap the points; the swap button is beside the fields.

**Where things are set:**
- Colours, fonts and sizes, including the map tint and mask: `frontend/src/styles/style.css`.
- Radius limits, start view, map style URLs and search timing: `frontend/src/config.js`.

**Screenshots** from `npm run test:e2e` are saved in `frontend/e2e/screens/` (not committed).

## Accounts and the database

Sign-in is Clerk (email code only); profiles and your own photo ratings are in our database under a random account id
(the email stays in Clerk). Locally the database is a SQLite file in `.local/` (not committed); on Render, Postgres.

```bash
cd backend
../.venv/Scripts/python -m app.db migrate   # create or update the tables (the API also does it when it starts)
```

To run with sign-in locally, put the Clerk **development** keys in `.env`: `CLERK_SECRET_KEY` and
`VITE_CLERK_PUBLISHABLE_KEY` (Clerk dashboard > API keys), then `npm run dev`. Test emails: any address with
`+clerk_test` (for example `you+clerk_test@example.com`) signs in with the code `424242`, no email sent.

The browser tests (`npm run test:e2e`) run the development server with `VITE_AUTH=off`: no Clerk, the profile stays in
the browser as before. `npm run build` refuses `VITE_AUTH=off` and needs `VITE_CLERK_PUBLISHABLE_KEY`.
If a development server is already running (with sign-in on), stop it before the browser tests: they reuse it.

```bash
cd frontend
npm run build && npm run check:bundle   # the built app must not contain any secret from .env (names printed, never values)
```

## Deploy on Render

`render.yaml` is the blueprint: one web service (FastAPI serves the API and the built frontend) and one Postgres
database, both in **Frankfurt**, with a 1 GB disk for the `runs/` caches. Nothing is deployed from this repo: in the
Render dashboard, New > Blueprint, pick this repo, then fill in the secret values it asks for.

**Plan tiers this needs** (check Render's current prices):
- **Web service: Starter** (paid). A persistent disk is not available on the free instance type, and the free one also
  sleeps when idle.
- **Disk: 1 GB** (the smallest), billed per GB a month. Without it the caches are lost at every deploy and ratings and
  thermal values are paid for again.
- **Postgres: Basic 256 MB** (paid). The free Postgres **expires 30 days after it is created** and is then deleted,
  with the profiles in it, so it is not used.

**Clerk: the development instance, also on Render.** A Clerk production instance needs a domain of our own, so for now
the deployed app uses the same Clerk **development** instance as local work: the same `pk_test_…` and `sk_test_…` keys.
Clerk shows a small "Development mode" badge, and development instances have usage limits (see Clerk's docs).
Moving to a production instance with our own domain is a later step (new `pk_live_…`/`sk_live_…` keys, the domain's
DNS records in Clerk, then the same env vars with the new values).

**Environment variables** (names only; values in the dashboard):
- you set: `OPENROUTER_API_KEY`, `INFRARED_API_KEY`, `MAPILLARY_ACCESS_TOKEN`, `CLERK_SECRET_KEY` (the dev instance's
  `sk_test_…`), `VITE_CLERK_PUBLISHABLE_KEY` (its `pk_test_…`), `CLERK_AUTHORIZED_PARTIES` (the Render address, e.g.
  `https://sencity.onrender.com`);
- set by the blueprint: `DATABASE_URL`, `PHOTO_SOURCE=mapillary`, `PYTHON_VERSION`, `NODE_VERSION`, and the per-user
  limits `LIMIT_CHAT_PER_HOUR`, `LIMIT_CHAT_PER_DAY`, `LIMIT_RUNS_PER_HOUR`, `LIMIT_RUNS_PER_DAY`,
  `LIMIT_MODEL_CALLS_PER_DAY`;
- optional, per address (defaults in `config/tool.yaml`, sized for a class on one network):
  `IP_LIMIT_SENSES_PER_HOUR` (100), `IP_LIMIT_CHAT_PER_HOUR` (600), `IP_LIMIT_AREA_PER_HOUR` (100),
  `IP_LIMIT_ROUTES_PER_HOUR` (50), `IP_LIMIT_THERMAL_PER_HOUR` (50, each run billed), `IP_LIMIT_SEARCH_PER_MINUTE`
  (120), `IP_LIMIT_REVERSE_PER_MINUTE` (120), `IP_LIMIT_PHOTO_PER_MINUTE` (600).

**By hand, once:**
1. Merge into `main` (the blueprint deploys `main`).
2. Render: New > Blueprint, pick this repo; enter the values above (the Clerk ones from the **development** instance).
   The web service, the database and the disk are all created in Frankfurt.
3. After the first deploy, set `CLERK_AUTHORIZED_PARTIES` to the service's address and redeploy.
4. Clerk dashboard (development instance): keep email code as the only sign-in method and the invite-only access mode;
   invite people from **Users > Invite**, with the redirect URL `<Render address>/sign-in`.
5. Open the site, accept an invitation, and check sign-in, a profile save and "Delete my account and data".

Build: `pip install -r backend/requirements.txt && cd frontend && npm ci && npm run build && npm run check:bundle`.
Start: `cd backend && python -m app.db migrate && uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
Health check: `GET /api/health` (the only public route).

## Common errors

| Error | What to do |
|---|---|
| `Missing GOOGLE_MAPS_API_KEY` | Add the key to `.env` at the repo root. An old `VITE_GOOGLE_MAPS_KEY` is not read. |
| The Senses card says "add OPENROUTER_API_KEY to .env" | Add the key to `.env` at the repo root, then press Retry. No restart is needed. |
| The Senses card says "The model settings cannot be used" | It names the file in `model/app_v9/` that is missing, wrong or does not match its sha256 in `MANIFEST.md`. Export the folder again from the thesis repo. |
| "Thermal comfort is not set up on the server." | Add `INFRARED_API_KEY` to `.env` and restart the API. |
| "No weather station near this area…" | No public station within `thermal.station_radius_km`; the area has no thermal comfort. |
| `Street View metadata error: REQUEST_DENIED` | The key is wrong, or Street View Static API is not enabled for it in the Google Cloud console |
| `OVER_QUERY_LIMIT` | Too many calls per minute or per day. Wait and re-run: cached answers are reused. |
| Overpass `429` / `504` / timeout | The public Overpass server is busy. Wait a minute and re-run. |
| `Radius … is above the test limit` | Add `--yes` once you have agreed to the larger run |
| `ModuleNotFoundError: tool` | Run the scripts from `backend/` |
| review.html shows no photos | Open it through `tool.review_server`, not as a file. Check the server console for Street View errors. |
| Many street segments without a photo | Check `photos.csv`. In tourist areas the nearest pano is often a contributor photo, which hides official panos nearby, even after the retry. |
| `outside the allowed area` | `area.allowed_polygon` is set in config. Clear it (set it to `null`) to allow any location. |
| Results did not change after editing sampling or retry settings | The run folder reuses `metadata.json`. Add `--refresh`. |
| The map stays empty, console says "Worker failed to load" | MapLibre must not be pre-bundled by Vite. Check that `vite.config.js` still has `optimizeDeps: { exclude: ['maplibre-gl'] }`, then delete `frontend/node_modules/.vite` and restart `npm run dev`. |
| `Port 5173 is already in use` | Another dev server is running. Use it, or stop it and start again. |
| Search says "Search is not available right now." | Look for `[api]` lines in the `npm run dev` terminal. "not started: no Python found" means the Python setup (`.venv`) is missing; "stopped (exit code …)" shows the error above it. If the API runs, Photon may be down; the map still works by clicking. |
| "This walk is 1.7 km. Routes go up to 1.5 km for now." | The shortest way is over `routes.max_walk_m`, even if the straight line is shorter. Choose closer points, or raise the limit (it costs more tiles); keep `routes.maxM` in `frontend/src/config.js` the same. |
| "This area needs 9 thermal runs; the limit is 8." | Even the shortest way needs too many tiles. Choose closer points, or raise `routes.max_jobs`. |
| Search says "Too many searches." | More than 30 searches a minute from one address. Wait a moment. |
| Playwright: "Executable doesn't exist" | Run `npx playwright install chromium` in `frontend/`. |
| Map tiles missing in the screen checks | The checks load real tiles from OpenFreeMap and need internet. |
