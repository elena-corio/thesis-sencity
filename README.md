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

### Tests

```bash
cd ..   # repo root
.venv/Scripts/python -m pytest backend/tests --rootdir backend
```

These test segment splitting and the selection rule on a small fixed sample. They make no API calls.

## Frontend

The app: the map start screen and the two-click area selection (boards Flow 1, 1b, 1c), in dark and light. It makes no backend calls yet. Requires Node.js 20 or newer.

```bash
cd frontend
npm install                     # once
npx playwright install chromium # once, for the screen checks
npm run dev                     # http://localhost:5173/map
```

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run dev` | Starts the app and opens http://localhost:5173/map in your browser; reloads on every change |
| `npm run build` | Builds the static site into `frontend/dist/` (for Render) |
| `npm run preview` | Serves the built site locally |
| `npm test` | Unit tests for the radius maths (Vitest), no browser needed |
| `npm run test:e2e` | Playwright: step screenshots, the fit-every-screen check at all sizes, both orientations, dark and light, 200% zoom and larger text, and the keyboard walk-through. Starts the dev server itself if it is not running. |

**Using the map:**
- Click to place the centre of your area, move to set the radius, then click again to fix it.
- Drag the edge to adjust. Esc or a right-click starts again.
- **Analyse this area** stores the area (no backend yet).
- Keyboard: Tab to the map, then Enter places the centre at the map centre, the arrow keys change the radius in 10 m steps, and Enter fixes it.
- Phone: tap the centre, then drag or tap a second point.

**Where things are set:**
- Colours, fonts and sizes, including the map tint and mask: `frontend/src/styles/style.css`.
- Radius limits, start view and map style URLs: `frontend/src/config.js`.

**Screenshots** from `npm run test:e2e` are saved in `frontend/e2e/screens/` (not committed).

## Common errors

| Error | What to do |
|---|---|
| `Missing GOOGLE_MAPS_API_KEY` | Add the key to `.env` at the repo root. An old `VITE_GOOGLE_MAPS_KEY` is not read. |
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
| Playwright: "Executable doesn't exist" | Run `npx playwright install chromium` in `frontend/`. |
| Map tiles missing in the screen checks | The checks load real tiles from OpenFreeMap and need internet. |
