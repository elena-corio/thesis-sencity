# Decisions

One entry per decision, newest at the top. **(proposed)** marks a choice Claude made where the brief leaves it open; it stands until Elena confirms or changes it. **(accepted)** means Elena confirmed it.

## 2026-11-04 – Thermal comfort on the streets (proposed details)
**Context.** Elena asked for thermal comfort after the photos, as a layer (boards Flow 3 and 2e). The brief fixes the source (Infrared.city `thermal-comfort-index`), the nearest public station, a fixed window per season, the 75th percentile along each street and the two-sided 1–5 score. These details were open.
**Decision.**
- *Order:* thermal runs after the photos, in the same `/api/area` stream (Elena's request), not in parallel.
- *Windows:* each season is one typical day of the weather file at one hour (spring 15 April, summer 15 July, autumn 15 October, winter 15 January; in config). One hour, not a range, because the docs do not say how a longer window is aggregated. Hours are the weather file's local standard time: no daylight-saving hour is added, so summer "15:00" is 16:00 on a Vienna clock.
- *Inputs:* buildings, trees and ground materials from the SDK's public data. Trees and ground are optional: if they cannot be read, the run goes ahead without them.
- *Cost guard:* `preview_area` counts the jobs first, and a run over `thermal.max_jobs` (4) is refused before anything is billed. New thermal runs are limited to 10 per IP per hour.
- *Cache:* per area, season and time in `runs/thermal/`: the grid as `.npz` (not GeoTIFF, which would need another library) and the values per segment as JSON.
- *Where the score is computed:* the server sends °C only. The app turns it into the 1–5 score and the state, because personal limits will come from the profile, which stays in the browser. Standard limits for now (26 / 32 / 38 and 9 / 0 / −13 / −27 °C).
- *Sampling:* cells within 4 m either side of a street line, or inside a park or square. Cells inside buildings have no value and are skipped. A street with no cell keeps no value and stays unlit.
- *Season and time bar (accepted, changes the brief's rule and board Flow 1c):* Elena wants it active before analysis, so the window is chosen first and a new area pays only for the season wanted. Choosing there starts nothing; only Analyse does. It is active again once thermal is ready, inactive while a run is loading, so paid runs cannot overlap. A new season or time is a new billed run unless it is cached, so the slider asks only when let go, and a 700 ms wait (`thermalDebounceMs`) makes arrow-key steps ask once. The chosen window stays for the next area. The streets keep their colours and label until the new values arrive; if the run fails or is cancelled, the previous window stays on screen and the area card says why. The photos are not looked up again.
- *Inputs, speed:* buildings, trees and ground are read in parallel. Trees and ground get 20 s (`thermal.optional_input_timeout_s`) and are skipped after that: the ground read hung for minutes on Elena's first run.
- *Place card on the Thermal layer (2e):* the photo and name stay at the top (Elena: board 2e has no photo, but she wants it), then thermal comfort only (the brief's "only the selected layer's scale").
- *Area card (Flow 4):* the stacked bar and counts follow the selected layer (Thermal for now), with "No value" for streets where the grid has none. "Places here" names the most common state per type (a tie goes to the worse state). "Why hard" waits for Senses, since thermal decides every hard street for now. The title stays "This area" (not "for you") until there is a profile. Print area report is shown as "Coming soon". "Thermal · general" instead of the board's "for you", since the limits are not personal yet. "Cooler street nearby" is the nearest street with a higher score (warmer on the cold side), with walking minutes at 80 m/min (in config). Clicking a street while the area is still loading opens its card; Back returns to the loading card.
- *Wording:* "UTCI" is never shown (brief §4). The legend says "Feels like temperature, hot or cold", and the card says "A simulation of sun, shade and wind, not a measurement."
**Consequences.** One new area costs about 10 tokens (a 500 m circle up to 40). Outside Vienna it works the same way; the station name is shown, so a distant station is visible. Tests never call Infrared.city: `backend/tests/conftest.py` empties the key and replaces the runner.

## 2026-11-03 – Thermal, Area and Routes (accepted)
**Context.** The new design boards rename the Heat layer to Thermal (it covers hot and cold) and the Map and Compare tabs to Area and Routes.
**Decision.** Elena asked for the renames. The app uses Thermal, Area and Routes in every label, and `thermalDefault` in `config.js`. The app's address is now `/area` (it was `/map`); `/` and any other path, `/map` included, redirect there. The `MapView` component and the `src/map/` folder keep their names, because they hold the map itself, which both Area and Routes use.
**Consequences.** Bookmarks to `/map` still work through the redirect. Old entries below are reworded to the new names.

## 2026-11-01 – Street segments and photos in the app (proposed details)
**Context.** Step 3: segments on the map, clickable, with their photos; no thermal or rating yet. The request fixed the endpoints, the cache, the photo proxy and the look; these details were open.
**Decision.**
- *Endpoints:* `POST /api/area` and `GET /api/photo/{pano_id}`, under `/api` like search, so one proxy rule covers the API in development.
- *Progress:* `/api/area` streams newline-separated JSON events (segments, then each segment with its photos, then the result), not one long answer. The loading card can show "34 of 58" and streets light up as their photos are found (brief §4). Cancel aborts the request, and the server stops its lookups when the app stops reading.
- *Speed:* segments are looked up 8 at a time (metadata calls are free). Streets, parks, squares and buildings come from one Overpass query instead of two. The public Overpass server is the slow part (30–50 s when busy); a cached area is instant. *Later:* our own copy of the OpenStreetMap data for Vienna, if loading stays slow.
- *Cache key:* the circle (rounded to ~1 m) plus the pipeline settings, so changing a threshold gives a fresh area.
- *Photo endpoint:* only (pano ID, heading) pairs chosen for a cached area can be fetched, so it is not an open Street View proxy. Limits: 60 images per IP per minute, 20 new areas per IP per hour.
- *Segment names:* the OSM name, or the way type if unnamed ("Footway"). Place types: street, pedestrian (street or area), park, square.
- *Colours:* light teal (`--map-seg`) with the soft halo for segments with photos; thin and dim (`--map-seg-none`) without. Selected: fully opaque, wider, with a white edge (dark teal in light mode), through a feature-state. An invisible wider line makes thin streets easy to click. All values are in `style.css`.
- *Ring:* at the clicked point (keyboard: the segment's middle). It pulses for 6 s, stops when the map moves, and never pulses with reduced motion.
- *Place card:* follows board 2f without the rating parts. In their place: "Not rated yet. Ratings come in the next step." Thumbnails are the street's other photos (at most 3, so the previous and next), and use the same URL, so each image is fetched once. On the phone sheet (P2), only the enlarge badge sits on the small photo; arrows, dots and thumbnails are on the full page (P2+).
- *No photo (2g):* "No street photo here yet, so this street will have no Senses or Overall rating.", "Go to the nearest street with photos" (by distance between segment middles), and the board's note. The thermal bar comes with the thermal step.
- *Enlarged photo:* "Not rated yet" where the photo's rating will go. The photo is `min(70vh, 80vw)` as in the brief, and also no taller than the screen minus its header and thumbnails, so it fits a 720 px laptop.
- *Keyboard:* a visually hidden list of the area's streets in reading order (top to bottom by ~30 m bands, then left to right). Focus shows a dashed ring and the hover style on the map. Enter opens the card with focus on "Back to area"; Esc closes it and returns focus to the street.
- *Loading card:* the board's rows: Street photos, then Thermal and Rating greyed (no Buildings row since the 2026-11-03 board; buildings are still fetched, for the indoor-photo check). The close button and Cancel both cancel.
**Consequences.** The first image call happens only when a street is opened (1–3 calls, about $0.007 each). The privacy notice should say that coordinates of chosen areas reach our API and Overpass.

## 2026-11-01 – Address search: Photon through our API
**Context.** The brief has "logo + search in one bar" and says search results scroll inside their own panel. It does not name a service or say what a result does.
**Decision (Elena).**
- *Service:* Photon (komoot, OpenStreetMap data, no key, built for suggestions while typing).
- *Route:* through our FastAPI backend, `POST /api/search`, not straight from the browser. The search text can be someone's own address. This way Photon never sees the user's IP, and the browser only talks to our API (brief §10).
- *Suggestions:* while typing, up to 5, after 3 letters and a 300 ms pause.
- *Picking a result:* only moves the map there. A street or area is fitted to its extent; an address or stop gets zoom 17. The area is still chosen with two clicks.
**Details (proposed).**
- *Privacy:* the text goes in the request body, not the URL, so it does not appear in access logs or the browser history. The API runs with access logs off and logs only the error type, never the text.
- *Ranking:* the map centre is sent as a bias, so nearby places come first (Vienna's Graben before other Grabens). Names are as in OpenStreetMap (German in Vienna).
- *Limits:* 3 to 100 characters, 30 searches per minute per IP (in memory), 5 s timeout. All in the `api` section of `config/tool.yaml`.
- *List:* the place type is shown before the detail line ("Pedestrian · Innere Stadt, Wien"), because several results often share a name.
- *Keyboard:* arrow keys, Enter, Esc. The first Esc closes the list, the second clears the text, and Esc in search never resets the area. The focus outline goes around the whole search bar.
- *Development:* `npm run dev` also starts the API (a small Vite plugin, `frontend/dev-api.js`, no new dependency) and stops it with the dev server. Vite forwards `/api` to the API on port 8000. In production `VITE_API_BASE` points to the Render API, and `api.cors_origins` must list the site.
- *Messages:* "No places found for "…". Try another spelling, or choose an area on the map." and "Search is not available right now. You can still choose an area on the map."
**Alternatives.** Nominatim (no search-as-you-type on the public server); a paid service (key and cost); calling Photon straight from the browser (Photon would see the user's IP and the text).
**Consequences.** Search needs the API running (`python -m app`). Without it, the map still works and search says so. Photon's public server has fair-use limits; for the public release, check them or host Photon. The privacy notice should name Photon (komoot, Germany) as a recipient of search text.

## 2026-11-01 – Desktop: the sun/moon switches the theme directly
**Context.** Elena tried the Appearance popover and did not want a menu there.
**Decision (Elena).** On desktop, one click on the sun/moon switches between light and dark and remembers the choice on this device. "System" (follow the device) stays available in the account menu, as on the phone (board P5). This replaces the popover in the entry below.
**Alternatives.** The three-way switch in a popover (brief §3, "the same Appearance switch replaces the single light/dark button on desktop"): one click more.
**Consequences.** This differs from brief §3 on desktop. The first click always leaves System mode; choosing System again happens in the account menu.

## 2026-11-01 – Dark mode: outside faded like light mode, stronger lit circle (changes brief §2 values)
**Context.** The OpenFreeMap Dark base map is almost black. First a darker mask (`#060d10` at 55%) was tried so the outside would read as dimmed, then no mask at all. Elena preferred the light-mode effect, where the outside is faded (lower contrast) rather than darkened.
**Decision (Elena).** Dark mode: mask in the ground colour `#13232a` at 50% (the brief's colour; brief: 60%), which fades the outside toward the panels like light mode does. The lit inside is raised to `#4f95a3` at 30% (brief: 18%), so the circle reads as the lit area at full contrast. Light mode keeps the brief's values. All values are in `frontend/src/styles/style.css`.
**Alternatives.** A darker mask (the outside goes almost black); no mask (the circle does not stand out enough); the OpenFreeMap "Fiord" style (lighter, but slate-blue, against the brief's grey-style rule).
**Consequences.** The dark-mode opacities differ from brief §2.

## 2026-11-01 – Frontend choices confirmed by Elena
**Context.** The first frontend step left four points open.
**Decision.**
- *Appearance on desktop:* the sun/moon icon stays, as on the boards, and opens a small popover with the System / Light / Dark switch. The account button opens the P5 menu, which has the same switch. *(Replaced the same day: the sun/moon now switches directly, see above.)*
- *Logo:* the paths from `frontend/src/assets/logo/sencity.svg` (black in the file), drawn in `var(--logo)`: white on dark, `#15474a` on light. The favicon is recoloured the same way, with a dark-mode media query.
- *Phone start screen:* there is no board, so it follows P1: the top bar, then the season/time row with Ask, then the hint. The left panel is hidden on a phone. "This area" is a bottom sheet above the tab bar. Once the sheet shows, the hint gives way to it, and the sheet says "Drag the edge of the circle to adjust."
- *Font:* Inter from Google Fonts (one `<link>`, no dependency).
**Consequences.** The browser contacts Google for the font. Self-hosting is a later option if the privacy notice should avoid it.

## 2026-11-01 – All colours, fonts and sizes in style.css
**Context.** CLAUDE.md: every colour, font and size is a variable in `frontend/src/styles/style.css`. Today's request had put the tint and mask colours in `config.js`.
**Decision.** The CLAUDE.md rule wins. Theme tokens, map tint, mask, lit circle and circle colours, their opacities, and every size are CSS variables. The map code reads them with `getComputedStyle` when the style loads, so a theme change reloads them. `config.js` keeps only non-visual settings: radius limits, start view, style URLs, photo estimate, default thermal window.
**Consequences.** To tune the map overlay, edit `style.css`, not `config.js`.

## 2026-11-01 – Two-click selection details (proposed)
**Context.** Brief §6 and boards Flow 1, 1b and 1c leave some details open.
**Decision.**
- *Centre marker:* a thin crosshair with a dot, as on the boards and in brief §4 ("the point clicked to load a new area is a thin crosshair"), rather than the "dot with a ring" in today's request.
- *Edge handle:* hollow while the radius is being chosen (1b), filled and draggable once set (1c). The chip shows "180 m / max 500 m" in 1b, a small "180 m" label in 1c, and turns amber with "500 m, maximum" past the cap.
- *Radius:* the ground distance (haversine) is rounded to 10 m, then snapped up to 50 m or stopped at 500 m. The stored radius is the rounded value, so the circle and the chip always agree.
- *Mouse:* after the first click, the circle grows from 50 m with the pointer. Dragging still pans the map.
- *Press and drag (touch, pen or mouse):* after the first tap or click, pressing and dragging sets the radius live and releasing fixes it; map panning is paused for that gesture. It is decided per gesture from the pointer type, not from the device, so it also works in a desktop browser's phone preview (fixed 2026-11-01, Elena found the radius only changed on the second tap there). A second tap or click also fixes it. With a finger, the chip sits 64 px above it.
- *Keyboard:* the map canvas takes Enter, the arrow keys (only once a centre is placed) and Esc. The handle starts at 60° (north-east, as on the boards). After Enter fixes the radius, focus moves to "Analyse this area"; after Analyse, to "Change area".
- *Map layers:* the tint and lit circle go under the street labels, so names stay readable. The mask goes over them, so everything outside is dimmed (brief §2).
- *Pan to the circle:* after the circle is fixed, if the card, sheet or other panels cover it, the map pans (and zooms out if needed) so the whole circle is in the free space.
- *Analysed state:* no backend call yet. The card shows "This area", coordinates, radius and "Change area". The hint, handle and radius line disappear; the lit circle and dimmed outside stay (Flow 2 without the loading card).
- *"About N street photos":* area × 1,860 photos/km² (kept photos per km² in the Stephansplatz 200 m run), rounded to 10. A placeholder, no API call.
**Alternatives.** Measuring the radius in screen pixels (wrong at other zooms and latitudes).
**Consequences.** All limits are in `config.js`; all sizes are in `style.css`.

## 2026-11-01 – Fitting every screen (proposed)
**Context.** Brief §3: no page scroll, no overlap, at 360 × 640 up to 1920 × 1080, both orientations, 200% zoom and a larger system font.
**Decision.**
- *1024–1199 px:* the right card replaces the left panel while it shows (brief §3).
- *Below 1024 px:* About and Print move into the account menu, and Ask becomes an icon.
- *Below 768 px:* phone layout (P1).
- *Short screens:* the left panel and the phone sheet scroll inside themselves as a last resort.
- *Bottom row:* the season bar and map controls sit above the credits line, which scales with the font size.
- *Inactive controls:* placeholders (About, Print, Ask, Routes, Profile, search) stay focusable with `aria-disabled` and "Coming soon". Controls that are inactive until an area loads (layers, places, season, time) are disabled and faded to 40%.
- *Checks:* the Playwright fit check emulates 200% zoom as half the CSS pixels at twice the density for the desktop sizes. A larger font is emulated as a root font size of 125%.
**Consequences.** On a landscape phone (640 × 360) the sheet scrolls and little map is left. That is acceptable for phase 1, which is desktop-first.

## 2026-11-01 – Courtyards are skipped
**Context.** Elena's suggestion after review: courtyards are often private, and their photos were interiors. OSM has no reliable courtyard tag; both problem areas were unnamed pedestrian areas, while every named square was fine. How enclosed an area is alone does not separate them (named squares 59–64%, the unnamed areas 54% and 79%).
**Decision.** A park, square or pedestrian area is skipped as a "courtyard" when it has no name and at least 50% of its edge lies within 2 m of a building footprint. Named areas are always kept, and paths through courtyards (passages) stay as street segments. Config: `osm.courtyard`.
**Alternatives.** Skipping every unnamed pedestrian area (would also drop open plazas without a name); a size limit (courtyards and small plazas overlap in size).
**Consequences.** At 200 m, 1 area was skipped (the 91 m² courtyard with the "© IMPULS" interior). The rule uses the area's full outline, not the part inside the circle. The other unnamed area (`relation/20221102`) is only 23% enclosed on its full outline, so it stays; its only photo is already rejected as indoor. Public unnamed courtyards are lost too.

## 2026-11-01 – Image classifier when the AI rating is added (planned)
**Context.** After the indoor rule, review still found an interior: a contributor photo ("© IMPULS", 2022-09) in a 91 m² courtyard (`way/867514530`, `highway=pedestrian` area). It sits in the open courtyard, not inside a footprint. Both contributor fallback photos kept at 200 m were interiors.
**Decision.** When the AI rating is built (W06–W07), the rating call also returns whether the photo is an outdoor view of a public space and is usable. A photo that fails is rejected like the 70% rule, and the next ranked photo takes its place. This adds no image calls, because the image is already sent for rating.
**Until then (Elena, 2026-11-01).** The contributor fallback in areas stays on as in brief §4. Interiors before the AI filter are acceptable for the prototype.

## 2026-11-01 – Photos inside a building footprint are rejected as "indoor" (proposed)
**Context.** In review, Elena found 3 interior photos among the kept ones. One was official Google imagery inside a building passage (`tunnel=building_passage`, a footway the brief keeps). One was a contributor photo used as a fallback in a small pedestrian area. Neither can be told apart from the metadata: `source=outdoor` and the official copyright do not exclude interiors.
**Decision.** Building footprints (OSM `building=*`, up to 50 m beyond the circle) are fetched once per run into `buildings.json`. A photo whose location lies inside a footprint shrunk by 1.5 m is rejected with the reason "indoor". This applies to official and contributor photos, on streets and in areas. An indoor official photo does not count as "official found" for the area fallback. Config: `osm.buildings_margin_m`, `selection.indoor_building_inset_m`.
**Alternatives.** Dropping building-passage segments altogether (the brief keeps passages); an image classifier for interiors (paid image calls, later if needed).
**Consequences.** At 200 m, 10 candidates (5 panos) were rejected as indoor, both flagged photos among them. Passage segments stay on the map, but they get no photo when the only photos are taken inside the building. An interior photo whose position is not inside a mapped footprint (an unmapped building, or GPS error) can still pass.

## 2026-11-01 – Leftover pieces merged into a neighbour (brief update; details proposed)
**Context.** The updated brief says a leftover piece under ~10 m is merged into its neighbour, not dropped, so no gaps appear at junctions.
**Decision.** After the cut into ~50 m pieces, the shortest piece under 10 m goes first. It joins a neighbour that shares an end with it: the one with the same street name, otherwise the longest, then the smallest id. This repeats until no short piece has a neighbour. A short piece with no neighbour is kept as its own segment. Only a piece under 1 m with no neighbour (a line that just grazes the circle edge) is dropped. Config: `segments.merge_below_m`, `segments.min_isolated_length_m`.
**Alternatives.** Merging only into the previous piece of the same chain (leaves the short chains between close junctions).
**Consequences.** Segments can now be up to ~85 m long. At 200 m, 2 isolated pieces under 10 m remain (shortest 2.8 m).

## 2026-11-01 – Official imagery on streets, contributor fallback in areas (brief update; details proposed)
**Context.** `source=outdoor` still returns contributor photospheres, and the metadata endpoint gives only the nearest pano, so a contributor photo can hide an official one. At 100 m, 105 of 143 panos were contributor photos.
**Decision (brief).** Streets use official Google imagery only. When the nearest pano is a contributor photo, the lookup is retried from nearby points with a smaller radius. Parks, squares and pedestrian areas use official photos first, and contributor photos only if no official one is found. Those are flagged as "contributor photo" (`photo_type` in photos.csv and segments.geojson, and a label in review.html).
**Details (proposed).**
- *Official:* the copyright matches `^© (YYYY )?Google$` (official panos read "© 2026 Google").
- *Retry:* 3 points at −4, 0 and +4 m along the street from the sample point, with a 5 m radius (`streetview.retry_radius_m`, `retry_offsets_m`).
- *Fallback:* decided per area. Contributor photos are allowed only when no official photo passes the date and distance filters; an official photo that is too far does not block the fallback. When an official photo exists, contributor photos are rejected as "contributor photo, official found".
- *Credit:* the review page shows "Google · contributor photo". The contributor's name is kept in metadata.json for the app's credit line later.
**Alternatives.** Pano ID length to tell official from contributor (works today but is undocumented).
**Consequences.** At 200 m: 218 sample points had a contributor photo nearest; the retry found an official pano for 86 of them. The retries roughly double the metadata calls (1,191 at 200 m, free). 18 of 122 street segments still have no official photo.

## 2026-11-01 – Area deduplication: one area per square (accepted)
**Context.** Stephansplatz is mapped both as `place=square` and as a `highway=pedestrian` area that lies entirely inside it, so it showed up twice.
**Decision.** An area is dropped when at least 80% of it (or of the other) is covered by an area already kept. Parks and squares are kept before pedestrian areas. `segments.max_area_overlap` in config.
**Alternatives.** Keep both (double photos and ratings for one place); union them (loses the name and type).
**Consequences.** One area per place. A pedestrian area that only partly overlaps a square is still kept.

## 2026-11-01 – Candidate sampling and selection thresholds (accepted)
**Context.** The brief fixes the selection rule but not the sampling or the distances.
**Decision.**
- One metadata call per sample point: every ~10 m along a street segment (centred in equal steps), on a 20 m grid inside parks and squares. Metadata search radius 15 m. The same point and radius are asked only once per run.
- A pano counts for a segment if it is within 15 m of the line (or of the area). Kept photos are at least 10 m apart ("different spots").
- Headings: streets, the street direction at the pano, both ways. The heading that looks toward the segment's middle is kept, and the other is logged as "same spot" (Elena chose one heading per spot). Areas: one heading, from the pano toward the middle of the area.
- Age: Street View dates are month-precise (YYYY-MM). "Older than 5 years" means more than 60 months before the run date, judged per segment.
- Ranking ties: after date and distance to the midpoint, the heading facing the midpoint, then pano ID and heading. This keeps the rule a pure, order-independent function.
- "Daylight" and "perspective view, not panorama": already given by official Street View and the Static API crop. There is no separate check.
**Alternatives.** Denser sampling (more metadata calls, little gain beyond pano spacing); using the nearest pano regardless of distance (photos of other streets).
**Consequences.** All values in `config/tool.yaml` under `candidates` and `selection`.

## 2026-11-01 – Segments: chains between intersections, cut into round(L/50) pieces (accepted)
**Context.** The brief says "~50 m segments, split where they branch or end" without defining the cut.
**Decision.** Ways are joined into chains between nodes where the network branches or ends (degree ≠ 2), so a street that OSM splits for a tag change stays one piece. Each chain is clipped to the circle, then cut into `round(L / 50)` equal pieces, so pieces fall between ~33 and ~75 m. Leftovers are then merged (see above). Areas under 50 m² are dropped. The query also reads roads up to 30 m outside the circle, so intersections at the edge are found.
**Alternatives.** Fixed 50 m cuts (leaves odd remainders); splitting at every OSM way end (many tiny pieces).
**Consequences.** In the dense old town many segments are short (median 36 m at 200 m).

## 2026-11-01 – Walkable ways and the "one line per street" filter (accepted)
**Context.** The brief says to use street centrelines and drop sidewalks and crossings, with the tag lists in config. The exact lists were left open.
**Decision.** Walkable: `highway` = primary, secondary, tertiary, unclassified, residential, living_street, pedestrian, service, footway, path, steps, track, cycleway, bridleway. Dropped: `footway=sidewalk|crossing`, `service=driveway|parking_aisle`, `access=private|no`, `foot=no`, `tunnel=yes`, `indoor=yes`. A `highway=footway` with no `footway=*` tag is treated as a sidewalk when 80% of it lies within 12 m of a road centreline. Areas: `leisure=park`, `place=square`, and closed `highway=pedestrian` ways with `area=yes`.
**Alternatives.** osmnx's "walk" network (heavier dependency, less control over sidewalks).
**Consequences.** Underground passages (the U-Bahn station under Stephansplatz: 120 ways) are not rated. The sidewalk graph for routing is not built yet (Routes, later).

## 2026-11-01 – OSM data from the public Overpass API (accepted)
**Context.** The brief says "streets come from OpenStreetMap" but not how.
**Decision.** One Overpass query per run (`way(around:radius)`, `out geom`), stored as `osm.json` in the run folder and reused on re-runs, so the same run gives the same segments. When the server is busy (429/502/503/504), the query is retried up to 3 times, 10–30 s apart.
**Alternatives.** A local OSM extract (heavier setup, not needed for one circle at a time).
**Consequences.** Needs internet. The public Overpass server can be slow or rate-limited.

## 2026-11-01 – Image check: per-tile sharpness and texture (accepted)
**Context.** The brief asks for a "simple sharpness check per tile" with a 70% threshold.
**Decision.** Grey image, 4 × 4 tiles. A tile counts when the variance of its Laplacian is ≥ 60 (sharp) and its grey-level spread is ≥ 12 (not flat, such as a bus side or a plain wall). The photo passes when ≥ 70% of tiles count. It runs only with `--check-images --yes`, only on photos that would otherwise be kept, and the image stays in memory only. All thresholds are in config.
**Alternatives.** An object detector for buses and walls (heavier; later if the review notes show it is needed).
**Consequences.** Untested thresholds. Tune them against `review_notes.csv`. A textured wall can still pass.

## 2026-11-01 – Review page served by a local FastAPI server (accepted)
**Context.** review.html must load images without exposing the key or saving files.
**Decision.** `python -m tool.review_server` (FastAPI, 127.0.0.1 only) serves the page, proxies `/image` only for (pano, heading) pairs in the run's photos.csv, sends `Cache-Control: no-store`, logs each image call with its cost to run.log, and writes `review_notes.csv`. The map uses MapLibre with OpenFreeMap Positron, as in the app.
**Consequences.** Images are not cached, so reloading the page costs the image calls again. Kept photos load as you scroll, and rejected ones only on click.

## 2026-11-01 – Street View crop and key name
**Context.** The brief says "same crop as the study" but the values were not in the repo. The existing key was named `VITE_GOOGLE_MAPS_KEY`, and Vite puts any `VITE_*` variable into the browser bundle.
**Decision.** 640 × 640, fov 90, pitch 0 (Elena's choice; to confirm against the study). The backend reads `GOOGLE_MAPS_API_KEY`. Elena renames the variable in her `.env`.
**Consequences.** If the study used other values, change `streetview.size/fov/pitch` in config. Nothing else changes.

## 2026-11-01 – Plain JavaScript in the frontend
**Context.** Elena asked for it (the brief said "TypeScript if comfortable").
**Decision.** Vue 3 with plain JavaScript, no TypeScript.
**Consequences.** No type checking in the frontend. Keep data shapes documented in architecture.md.

## 2026-11-01 – Any location can be selected
**Context.** Elena asked for it, and the brief now says so (§3, states and errors).
**Decision.** No city is hard-coded. An optional allowed-area polygon (`area.allowed_polygon`, GeoJSON, lon/lat) is empty by default; when set, fetch_photos refuses a centre outside it. Outside Vienna, the area card will say "Tested in Vienna. Elsewhere, predictions are less certain."
**Consequences.** Photo coverage, thermal data and OSM quality vary by place. Rate limits and the 500 m maximum still cap cost.

## Fixed by the brief (recorded 2026-11-01)
Decisions already made in `docs/tool-build-prompt.md`. Ask before changing any of them.

- **Stack.** Vue 3 + Vite + Pinia + Vue Router in the frontend, Python + FastAPI in the backend. Plain CSS with custom properties, Inter only.
- **Map.** MapLibre GL JS with a ready-made grey style (OpenFreeMap Positron / Dark), flat top-down view, no 3D buildings. Infrared.city is used for data only, never drawn.
- **Hosting.** Render, Frankfurt (EU) region for everything, deployed from GitHub. Secrets only in Render environment variables.
- **Two phases.** Phase 1: no accounts. Phase 2, if time allows: Clerk accounts and an EU Postgres.
- **Accounts (phase 2).** Clerk, passwordless, invite-only allowlist. FastAPI verifies the session token.
- **Profile in the browser (phase 1).** Stored in localStorage only. The server stores nothing about the person.
- **Zero data retention.** AI models only through paid endpoints with zero data retention, never free endpoints. The routing is the same as the study's.
- **One map layer at a time.** Thermal, Senses or Overall. Overall is the worse of the two, and segments with no photo stay unlit.
- **Street View terms.** Store pano IDs, location, date and heading only. Fetch images on demand through the backend. The prototype stays private.
