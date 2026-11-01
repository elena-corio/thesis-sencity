# Decisions

One entry per decision, newest at the top. **(proposed)** marks a choice Claude made where the brief leaves it open; it stands until Elena confirms or changes it. **(accepted)** means Elena confirmed it.

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
**Consequences.** Underground passages (the U-Bahn station under Stephansplatz: 120 ways) are not rated. The sidewalk graph for routing is not built yet (Compare, later).

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
**Consequences.** Photo coverage, heat data and OSM quality vary by place. Rate limits and the 500 m maximum still cap cost.

## Fixed by the brief (recorded 2026-11-01)
Decisions already made in `docs/tool-build-prompt.md`. Ask before changing any of them.

- **Stack.** Vue 3 + Vite + Pinia + Vue Router in the frontend, Python + FastAPI in the backend. Plain CSS with custom properties, Inter only.
- **Map.** MapLibre GL JS with a ready-made grey style (OpenFreeMap Positron / Dark), flat top-down view, no 3D buildings. Infrared.city is used for data only, never drawn.
- **Hosting.** Render, Frankfurt (EU) region for everything, deployed from GitHub. Secrets only in Render environment variables.
- **Two phases.** Phase 1: no accounts. Phase 2, if time allows: Clerk accounts and an EU Postgres.
- **Accounts (phase 2).** Clerk, passwordless, invite-only allowlist. FastAPI verifies the session token.
- **Profile in the browser (phase 1).** Stored in localStorage only. The server stores nothing about the person.
- **Zero data retention.** AI models only through paid endpoints with zero data retention, never free endpoints. The routing is the same as the study's.
- **One map layer at a time.** Heat, Senses or Overall. Overall is the worse of the two, and segments with no photo stay unlit.
- **Street View terms.** Store pano IDs, location, date and heading only. Fetch images on demand through the backend. The prototype stays private.
