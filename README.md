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
| `GOOGLE_MAPS_API_KEY` | Google Maps Platform key with **Street View Static API** enabled. Backend only: never name it `VITE_*`, because Vite would put it in the browser bundle. |
| `INFRARED_API_KEY` | Infrared.city key for thermal comfort. Each new area or route and season/time is billed: 10 tokens per 512 m tile (a circle up to ~250 m is usually 1 tile, 500 m up to 4; a route about 4–6, at most 8). Backend only. |
| `OPENROUTER_API_KEY` | OpenRouter key for the Senses predictions. Each new photo is one paid call, sent to the zero-retention endpoint pinned in `model/app_v0/model.json`. Backend only: never name it `VITE_*`. |

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

### `tool.review_server`: check the photos

```bash
../.venv/Scripts/python -m tool.review_server                       # the latest run
../.venv/Scripts/python -m tool.review_server --run 2026-11-01_48.2085_16.3721_r100
```

Open http://127.0.0.1:8765/ and stop the server with Ctrl+C.

- **Left:** a map with the circle (dashed), the segments (cyan with a kept photo, grey without), parks and squares, and the photo points (dark = kept). Click a segment to jump to its photos.
- **Right:** one card per segment with its kept photos, and the date, heading, rank and distances under each. Rejected photos are in a collapsed "Rejected" section, grouped by reason. They load only when you click "Load photo".
- **Keep / Reject** on any photo saves your verdict, and the optional note, to `review_notes.csv` in the run folder. Click again to clear it. Use these notes to tune the filter thresholds.
- **Costs:** every photo shown is one paid Street View image call. The page shows the total for the kept photos, and the server prints and logs each call. Images are never saved or cached, so reloading the page fetches them again.

### `app`: the SenCity API

The backend the app talks to. `npm run dev` starts it for you (see Frontend); you only need the commands below to run it on its own.

| Endpoint | What it does |
|---|---|
| `POST /api/search` | Address and place search through Photon (komoot, OpenStreetMap data, no key). The text travels in the request body and is never logged. |
| `POST /api/area` | Street segments and their chosen photos for one circle `{lat, lon, radius}`: the `tool.fetch_photos` pipeline, metadata calls only (free). It streams its progress, and the result is cached in `runs/areas/<key>.json` (segments and photo metadata only, no images). A cached area answers at once. If the photo lookups fail, the steps already done are kept next to it (`<key>.osm.json`, `<key>.photos.json`), so Try again goes on from there; they are removed once the area completes. |
| `POST /api/routes` | Two walking routes between two points `{start, end, limits, season, time}`: the shortest, and the easiest at most 25% longer. It streams progress: streets, photos along the way (free), thermal comfort along a narrow corridor (billed, cached), then the two ways. Start and end travel in the body and are never logged or stored. |
| `GET /api/photo/{pano_id}?heading=…` | One Street View image (640 × 640, fov 90, pitch 0, as in the study), streamed through and never written to disk. Only photos chosen for a loaded area or route can be fetched. Each is one paid image call (about $0.007); the browser keeps it for an hour (`Cache-Control: private`). |
| `POST /api/senses/rate` | The model's general predictions for the photos of an area or route, streamed as they finish. Cached photos answer at once and cost nothing; the others are fetched from Street View in memory and rated, 4 at a time, up to 250 per run. Only photos of a loaded area or route are accepted. See "Senses mode" below. |

Access logs are off, and request bodies are never logged.

```bash
cd backend
../.venv/Scripts/python -m app            # http://127.0.0.1:8000, Ctrl+C to stop
../.venv/Scripts/python -m app --reload   # restarts when the code changes
```

Settings are in the `api` section of `config/tool.yaml`: allowed browser origins; for search, the Photon URL, text length, number of results and rate limit; for areas, the cache folder, parallel lookups and the limit of new areas per IP per hour; for photos, the limit per IP per minute and how long the browser may keep them. The key `GOOGLE_MAPS_API_KEY` is read from `.env` on the server only.

After the photos, `/api/area` runs **thermal comfort** for the circle (Infrared.city, season and time from the request, default summer 15:00) and sends the feels-like °C per street. It is billed per run and cached in `runs/thermal/` per area and window, so the same area, season and time is never paid for twice. A run that would bill more than `thermal.max_jobs` jobs is refused before anything is sent. Settings are in the `thermal` section of `config/tool.yaml`; the key `INFRARED_API_KEY` is read from `.env` on the server only. Without the key the photos still load and the app says thermal comfort is not set up.

A new area takes about a minute: most of it is the public Overpass server (OpenStreetMap), which is often busy. The photo lookups run in parallel and take a few seconds.

A new **route** costs one thermal run on a corridor around its possible ways: about 4–6 tiles (40–60 tokens), at most `routes.max_jobs` (8, so 80 tokens), checked with the free preview before anything is billed. A new season or time for that route is another run; the same route and window, in either direction, is never paid for twice. It takes about 2.5 minutes before thermal (Overpass, then about 2,000 metadata calls), plus the simulation. Corridors are cached in `runs/routes/`, with no start or end in them. Settings are in the `routes` section of `config/tool.yaml`.

**Senses mode (general prediction, no profile).** To try it: add `OPENROUTER_API_KEY` to `.env`, run `npm run dev` in `frontend/`, and analyse an area (Senses is the layer the app opens on). Every photo is rated in the background, nearest first, and places appear on the map as ratings arrive, with the most comfortable places and the places to avoid beside them. A route is rated too, once its two ways are ready. Clicking a place opens its detail with no new call.

**Costs.** Each new photo is one paid model call (about $0.001 or less) and one paid Street View image (about $0.007, the first 10,000 a month free). A default 200 m area has about 236 photos: about $0.25 for the model and about $1.65 for Street View at list price. A run rates at most 250 new photos; above that the app asks first, with the estimated cost of the rest. A photo already rated costs nothing.

Everything about the model comes from `model/app_v0/` (exported from the thesis repo), read on every request. To change the setting, replace that folder: no code change or restart. The reasoning order and any model, endpoint or image setting are picked up. If a file is missing or does not parse, or the export breaks a privacy rule (`zdr`, `data_collection`, `allow_fallbacks`, a free endpoint), the app shows which file is wrong and sends nothing. An `input` other than `photo` is refused too: the export has no describer model or prompt to build it from.

Results are cached in `runs/senses/predictions.json` (not committed) per pano ID, heading and the MANIFEST's commit, so a new export starts fresh. It holds only the JSON output, the model ID, latency and cost: never an image. Other settings (OpenRouter URL, timeout, how many at a time, the cap, the limit per IP) are in `api.senses` in `config/tool.yaml`.

### Tests

```bash
cd ..   # repo root
.venv/Scripts/python -m pytest backend/tests --rootdir backend
.venv/Scripts/python -m pytest backend/tests/test_senses.py --rootdir backend   # only the Senses request and replies
```

These test segment splitting, the selection rule, the route finder, and the API: search (with a fake Photon), areas (from a fixed cached sample), routes (with made-up streets and temperatures), photos (the key never in the answer, nothing written to disk), and Senses (the request built from `model/app_v0/`, validated replies, the retry, the cache, the cap, at most 4 at a time). They make no API calls.

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
| `npm run build` | Builds the static site into `frontend/dist/` (for Render) |
| `npm run preview` | Serves the built site locally |
| `npm test` | Unit tests for the radius maths, thermal score and route stretches (Vitest), no browser needed |
| `npm run test:e2e` | Playwright: step screenshots; the fit-every-screen check at all sizes, both orientations, dark and light, 200% zoom and larger text, with the place card and the enlarged photo open; the keyboard walk-through; search; streets and photos; Routes, with its own fit check. The API is mocked (a fixed Stephansplatz area in `e2e/fixtures/`, made-up routes, a placeholder image), so no Street View, Overpass, Infrared.city or OpenRouter calls are made. Starts the dev server itself if it is not running. |

**Using the map:**
- Search: type at least 3 letters of a street, address or place, then pick a suggestion with the mouse, or with the arrow keys and Enter. The map moves there. Esc closes the list, a second Esc clears the text.
- Click to place the centre of your area, move to set the radius, then click again to fix it.
- Drag the edge to adjust. Esc or a right-click starts again.
- **Analyse this area** loads the streets, then their photos (about a minute for a new area). The loading card shows the progress; streets light up as their photos are found. Cancel goes back to the circle.
- Streets with photos are light teal with a soft glow; streets without a photo are thin and dim. Click a street to open its card: up to 3 photos with arrows, date and direction ("Looking north-east, July 2024"). Click the photo to enlarge it; arrow keys switch photos, Esc goes back. A street without a photo offers "Go to the nearest street with photos".
- Photos load only when you open a street (each is one paid Street View call); nothing is fetched for the whole area.
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

## Common errors

| Error | What to do |
|---|---|
| `Missing GOOGLE_MAPS_API_KEY` | Add the key to `.env` at the repo root. An old `VITE_GOOGLE_MAPS_KEY` is not read. |
| The Senses card says "add OPENROUTER_API_KEY to .env" | Add the key to `.env` at the repo root, then press Retry. No restart is needed. |
| The Senses card says "The model settings cannot be used" | It names the file in `model/app_v0/` that is missing or wrong. Export the folder again from the thesis repo. |
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
