# Decisions

One entry per decision, newest at the top. **(proposed)** marks a choice Claude made where the brief leaves it open; it stands until Elena confirms or changes it. **(accepted)** means Elena confirmed it.

## 2026-11-07 – Thermal legend: title, info tooltip, no source line; "Layer" in Routes (accepted)
**Context.** Elena asked for a simpler legend and the same labels in Area and Routes.
**Decision (Elena).**
- *Bands:* unchanged from the entry on bands (easy 9 to 26, mixed 26 to 32 or −13 to 9, so 0–9 °C is mixed, hard beyond), standard for everyone from `thermalLimits` in config.
- *Legend:* always the last block, after a divider, in the Area and Routes panels, and only once there is something to read: the area's thermal comfort is loaded, or the routes are ready (no placeholder legend or status line before). Title "Thermal comfort °C", no subtitle; the rows are plain numbers ("Easy, 9 to 26"); Mixed and Hard keep the side rule. No line on which side is shown and no source line: the source is in the tooltip and the map credits. The full-scale panel is gone.
- *Info icon:* a plain 15 px icon after the title, focusable, with the tooltip text as its label. The tooltip shows on hover, keyboard focus and tap: "Feels-like temperature (UTCI). How hot or cold it feels on the body: air temperature, sun, shade, wind and humidity together. Easy is 9 to 26 °C, where most people feel no heat or cold stress. Simulated by Infrared.city." Esc, blur or a tap elsewhere close it (Esc closes only the tooltip). This is the one place the UI names UTCI (brief §4 updated).
- *Labels:* "Colour the routes by" (Routes panel) and "Colour by" (phone) are now "Layer", with the button group labelled "Layer", as in Area.
**Consequences.** The weather station's name and "A prediction, not a reason" no longer appear under the legend; the place card and the area card still say "a prediction, not a reason".

## 2026-11-07 – Area and walk inputs: compact, typing on request, one Change (proposed)
**Context.** Elena: clicking on the map stays the default; typing should be offered, not always open; one tap should clear an area or a walk; the route instructions repeated each other.
**Decision (Elena; details marked proposed).**
- *Top search:* only moves the map (city, street, place); it never sets a centre, start or end.
- *Hints:* "Click to place the centre of your area, or type an address", "Click where you start, or type an address", "Now click where you want to go, or type an address". "type an address" opens the inputs and focuses the first empty field. A walk that is too short or too long says why in the hint (the 3-step card that showed it is gone).
- *Inputs* (`AreaInputs`, `RouteInputs` on `InputSection`): at the top of the left panel, closed by default on desktop as one row ("Graben · 200 m", "Clicked point → …") with a chevron (`aria-expanded`); hidden before anything is set unless the hint opened them. Open: Centre and Radius, or Start and End. Map clicks still fill the next empty field; while a field has the focus, the next map click fills that one (kept 1 s after the click takes the focus). A city, town or district (Photon `osm_value`) only pans the map; an address or a named place sets the point. A clicked centre, start or end shows as its coordinates ("48.2097° N, 16.3708° E", also for Enter at the map centre), never "Clicked point"; no reverse geocoding (Elena asked for coordinates or an address).
- *Radius (Elena):* 100, 200 and 500 m (`config.radius.presets`; 200 is the default, 100 loads fastest), plus the radius the mouse set. Not 1 km: 500 m is the API's maximum (cost and rate limits, brief §6); offering 1 km would mean raising it.
- *Where (proposed):* on a phone and below 1200 px the left panel gives way to the card, so the area inputs sit at the top of the area card (open on a phone). On a phone, "type an address" opens the sheet with only the inputs.
- *Routes on a phone, like Area (Elena):* the same top bar (the search only moves the map) and Ask row; no Start and End fields up there any more. The hint's "type an address" opens the sheet ("Choose a walk") with the inputs open and Start focused; once both points are set the sheet is "This walk" with the inputs row and Change on top, then Layer and season and time. The swap button lives in the open inputs (also on desktop). Picking a suggestion finishes that field: the next map click fills the next empty one.
- *Change:* next to the row, clears centre and radius (or start and end), removes them from the map and goes back to clicking with the first hint. "Change area", its line in the card's foot, and "Start again" in the area and walk cards are removed; Esc still starts again while choosing.
- *Removed:* "SenCity finds two ways…" in the Routes panel and the 3-step card while choosing points (no card then; the hint shows on every screen size).
- *"How this works":* it does not exist yet (the About button is "Coming soon"). "The easiest way is at most a quarter longer than the shortest" goes there when it is built; until then it is not shown.
- *Found on the way:* the search field ignored the next typing after a pick whose name equalled the typed text ("Linz" → Linz); fixed in `PlaceSearch`.
**Consequences.** After Analyse, keyboard focus goes to the card's title (Change is no longer in the card). Brief §3 is updated where it named "Change area", "Start again" and the step card.

## 2026-11-07 – Try again goes on from the failed step (proposed)
**Context.** Elena: when loading fails, Try again should rerun only the failed step. Before, a failure in the streets or photos lost everything (the next try fetched the streets and every photo again), and Try again after a thermal failure reloaded the whole area in the app.
**Decision.**
- *API:* the finished steps of a load are kept next to the cache under the same key (`backend/app/steps.py`): the Overpass answer once it arrives, and the photos chosen so far per segment when a lookup fails or the app cancels. The next request for the same area or route reads them back: no new street query (and no "streets" stage), photo lookups only for the segments still missing, and the progress starts at what was found (`done` in the "segments" event). Such a retry is not counted as a new area or route for the rate limit. When the load completes, the result is cached as before and the steps are removed. A finished route corridor and thermal comfort were already cached.
- *App:* Try again after the streets or photos failed keeps the streets on the map and the progress ("12 of 40" goes on, never back to 0); after thermal failed it asks for thermal only (`retryThermal`) and the map stays as it is. Routes: Try again keeps the progress on screen.
- *Privacy:* only OpenStreetMap data and photo metadata (pano IDs, location, date, heading) are kept, never images; nothing about a route's start or end, as for the route cache.
**Alternatives.** Saving after every photo (more writes; the save on failure or cancel is enough). Keeping the steps in the browser (the API would still repeat the calls).
**Consequences.** A load that fails and is never retried leaves its step files in `runs/` (not committed). A step file that is half written is ignored and that step is done again.

## 2026-11-07 – Thermal has no 1–5 score: a temperature bar on the card (accepted)
**Context.** Elena: thermal has three levels, not a 1–5 score. The card showed "Hard · 2 of 5" and a 1–5 bar with ticks.
**Decision (Elena).** The thermal score is gone everywhere: no `thermalScore`, no `thermal_score` on the segments, no "x of 5". The state comes straight from the limits, which shrink to `{ heat: [26, 32], cold: [9, −13] }` in the app and the API (the third values only split hard into 2 and 1). The card's thermal box shows a temperature bar on the legend's side rule, from the values on screen (the area, or the routes for a stretch): heat side 9 to 40 °C, cold side −20 to 26 °C (hard on the left), both −20 to 40 °C (`config.thermalBar` holds −20 and 40). A smooth gradient from the level colours: cyan through the easy band, amber at the middle of the mixed band, red from the hard border on. The same diamond marker as before sits at the place's value, clamped at the ends. Labels only at the ends and band borders (heat side: 9, 26, 32, 40 °C; the unit once, on the last). `role="img"`, e.g. "Feels like 31 °C on the heat side of the scale". The senses box (not built yet) keeps its 1–5 rating and bar.
**Consequences.** Brief §4 and the design notes no longer describe a thermal 1–5 score.

## 2026-11-07 – Season and time move into the layer controls; legend last (accepted)
**Context.** Elena asked to remove the floating season and time bar at the bottom of the map and to order the left panel controls first, legend last.
**Decision (Elena; the details marked proposed).**
- *Where:* `SeasonTime.vue`, directly under the layer choice: in the Area left panel under Layer, in the Routes panel under "Colour the routes by", and in the area or route card where the left panel gives way. A label "Season and time" with "Changes heat and cold", a 4-part season radiogroup (arrow keys move and choose, one Tab stop), then the time slider, 9:00–21:00 (`config.thermalHours`; before, 6–21), with the time beside it.
- *When:* only for Thermal and Overall, hidden for Senses; the choice stays in the store, so it is kept across layers. Before analysis no layer is on yet and the choice is free (Analyse uses it), so the block shows then too (proposed).
- *Phone and below 1200 px (proposed):* the left panel gives way to the card there, so the area card now carries the layer buttons (`LayerButtons.vue`, as the route card already had "Colour by") and season and time under them. The phone route card shows the block under "Colour by", and in "This walk" before Analyse. The phone row under the search keeps only Ask; in Routes that row is gone and the sheet starts under Start and End.
- *Left panel order:* Layer → Season and time → Places → divider → Legend. The legend's "which side is shown" line is removed; the source note stays. No limits note, since all limits are standard.
- *Height:* the left panel now reaches down to the bottom row. The right-hand cards already stopped above the zoom and re-centre controls, which stay in the bottom-right corner, so the bar's removal frees no height for them.
**Consequences.** On a phone and a tablet, season and time are reached from the area card, not while a place card is open. `SeasonBar.vue` and its tokens are gone. Brief §3 (bottom centre bar) and the design notes are updated.

## 2026-11-07 – Thermal bands: 0–9 °C is mixed; ranking by comfort distance; legend for the side shown (accepted)
**Context.** Elena: 0–9 °C was easy (brief §4: 0–9 → 4), and should be mixed. Places were ranked "coolest first", which is wrong in the cold. The legend listed both sides at all times. The backend scored the routes with its own copy of the band rule, defined twice in `tool/thermal.py`.
**Decision (Elena).**
- *Bands (standard UTCI, for everyone):* easy 9 to 26 °C; mixed 26 to 32 (moderate heat) or −13 to 9 (slight and moderate cold, so 0–9 °C is mixed); hard above 32 or below −13. One config: `thermalLimits` (now `{ heat: [26, 32], cold: [9, −13] }`) in `frontend/src/config.js`, read only through `thermalLimits()`; the routes send them to the API, whose `thermal_state` follows the same rule (the duplicate is gone; the request's cold list now has 3 values). (The 1–5 score was then removed: see the entry on the temperature bar.)
- *No personal limits yet:* profiles are not built, so nothing is personal in this change (no "your" in the UI). The brief's rule (3 °C shifts) stays for later.
- *Comfort distance:* `comfortKey` in `src/lib/thermal.js`: 0 inside the easy range, otherwise the degrees outside it; inside, then the degrees from the middle of the range, (9 + 26) / 2 = 17.5 °C, computed from the limits in use (no separate constant). "Cooler / Warmer street nearby" ranks by it, then the walking distance; the suggestions rank by it too (all of them are easy, so the second part decides).
- *Legend (`ThermalLegend.vue`, Area and Routes):* "Easy, 9 to 26 °C" always; Mixed and Hard only for the side the values on screen reach: heat when none is below 9, cold when some are below 9 and none above 26, both (two short lines each) otherwise. An info button, "Show the full scale, heat and cold", opens the full scale on click (no hover), 44 px on touch.
- *Place card:* "Hard: above 32 °C" or "below −13 °C", only the side that applies (Mixed and Easy alike).
**Kept from the brief.** The legend title stays "Feels like temperature, hot or cold": the brief says the term UTCI is never shown in the UI.
**Consequences.** Streets at 0–9 °C now show as mixed on the map, in the counts and on the routes. Brief §4 and the design notes are updated to match.

## 2026-11-07 – "Likely easiest for you" on the Thermal layer; Places chips turned on (proposed)
**Context.** Elena asked for up to 3 suggested places per loaded area on the Thermal layer, with numbered pins, a list in the area card, and a filter by place type. The Places chips were inactive placeholders.
**Decision (Elena chose the filter scope; the rest is proposed).**
- *Places chips:* active once the area's streets are loaded. They filter the map (the streets drawn, clickable and in the keyboard list) and the suggestions. The area card's counts stay for the whole area. A selected place the filter hides closes its card.
- *Selection:* `pickSuggestions` in `src/lib/suggest.js`, reusable with another keep and value. Thermal keeps easy places (the limits the card uses, standard for now) and ranks them by closeness to comfort (`comfortKey`, see the entry on bands and comfort distance; first it was "coolest first"). Greedy: each pick at least 150 m from the others (between middles); among places within 1 °C (in distance from the comfort target) of the best one left, a type not picked yet (street, park, square) goes first; a tie goes to the place nearer the area centre. `config.suggest` holds 3, 150 m and 1 °C.
- *Display:* one marker style for suggestions and later chat results. On the map, the stretch is drawn thicker in its level colour with a white outline, above the street colours and below the hit layers (so it is still clicked as usual), and a numbered pin sits centred on its middle: a 28 px badge in a 44 px button, aria-label "Suggestion N: <name>". When that place is selected (pin, list row or a click anywhere on it), the selection ring takes the pin's place, at the same point, and the pin comes back once the place is no longer selected (Elena asked). New tokens `--marker-*` (the dark edge and number stay #13232a in both themes). The list sits in the area card under the counts, with the same badge, name, type, feels-like and level. No card opens by itself, and the place card shows nothing about suggestions.
- *Behaviour:* selecting a suggested place keeps the other markers and adds a "seen" tick to its row. Selecting any other place hides the markers, with no popup (Elena removed the one-line "N suggestions" that first brought them back); "Back to area" brings them back. Seen ticks reset with a new area.
- *Chat hook:* `showChatResults(list)` replaces the suggestions with the same markers (list title "From your question", a Clear button); `clearChatResults()` brings the suggestions back. Not called yet.
**Alternatives.** A score-only rank (ties everywhere, since all easy places score 4 or 5). Distance along streets for the 150 m. The chips filtering only the suggestions.
**Consequences.** In a small circle (100 m radius) usually only 1 or 2 places can be 150 m apart. Below 1200 px wide the left panel gives way to the area card, so the Places chips can only be reached on wide screens (as before for the layer buttons). On the dark map the pin's dark edge blends into the background, so the pin looks smaller than it is.

## 2026-11-07 – "Cooler street nearby" as a link (proposed)
**Context.** Elena asked for the line on the thermal place card to be a real link that takes you to that street and back. It showed the nearest street with a higher 1–5 score at any distance, and following it only panned the map.
**Decision.** The line shows only when a street within 300 m is at least one level better (hard → mixed or easy, mixed → easy). The one closest to comfort wins (`comfortKey`, see the entry on bands and comfort distance), then the shorter walk; at first it was the closest, with ties to the cooler street. "Warmer street nearby" when the street is too cold (below 9 °C), "Cooler street nearby" when too warm. Distance is a straight line between the middles of the two stretches, as before; minutes use 80 m per minute. The level uses the limits the card rates with: only the standard ones exist so far ("Thermal · general"), so personal limits from the profile will replace them in one place (`limits` in PlaceCard). Following the link selects the street as a map click does, zooms to it (up to zoom 17, never out of a closer view), and keeps the season, time and layer. The card of that street shows "Back to <street>", one step only. The selection ring pulses on the new street as after a click: the pulse now stops only when the person pans or zooms, not when the app moves the camera (before, the zoom cancelled it at once; this also keeps the pulse when a map click pans to fit the street). The selection is `easierNearby` in `src/lib/nearby.js`, so Senses and Overall can reuse it with their own level. `config.nearby` holds the 300 m and the zoom. The link is now shown only on cards opened from the map, not on route stretches (following it would select a street of the area).
**Alternatives.** Walking distance along the streets (needs the route finder in the browser). A tie as the same walking minute (could pick a street almost twice as far). A history of several back steps.
**Consequences.** A hard street with no better one within 300 m shows no nearby block. The link is two lines high, so the thermal card is a little taller.

## 2026-11-07 – Place filter: All, Streets, Parks, Squares (proposed)
**Context.** Elena asked for a simpler place filter. The chips were All / Parks / Squares / Markets / Busy roads / Residential, still inactive placeholders. She also asked to move the app to the v8 sensory items (Sight before Hearing), but the app holds no sensory items yet: onboarding, profile, sense lists, prompts and EN/IT strings are not built.
**Decision.** Chips All / Streets / Parks / Squares, from OSM: Streets = every highway way (pedestrian streets included, pedestrian areas excluded), Parks = `leisure=park`, Squares = `place=square` or a `highway=pedestrian` area. One helper, `placeGroup` in `src/lib/place.js`, maps a segment from its `place_type` and geometry; the area card's "Places here" uses it too. The chips stay inactive, as before (Elena asked for the list, not the filtering). The sense icons README lists the icons in the v8 order: sight, hearing, smell, touch, thermal, vestibular, proprioceptive, interoceptive.
**Alternatives.** A new `place_group` property from the backend (cached areas would lack it until reloaded). Wiring the chips to the map now.
**Consequences.** No backend change. When the sensory items are built, take the v8 list and order from the survey, keyed by sense code rather than position.

## 2026-11-05 – Street names wrap instead of being cut (accepted)
**Context.** Elena: the cut names bother her ("Stephansp…" on the card). Beside the photo the name has about 128 px at 20 px text, so one long word did not fit. Brief §3 asked for an ellipsis and a tooltip.
**Decision (Elena asked; the way is proposed).** Names wrap everywhere they are shown as text: the place and stretch card, the preview, search suggestions and the hover label. The card's name is marked as German, so the browser hyphenates it where it has a dictionary, and otherwise breaks at any letter. The layout of board 2f stays. The Start and End fields are text inputs, which cannot wrap, so a long name there still ends in an ellipsis; the preview shows it in full.
**Alternatives.** The name above the photo at full width (one line for almost every name, but it moves away from the board and pushes the card down). Smaller text (still cuts the longest names).
**Consequences.** A very long name takes three or more lines beside the photo. Outside Vienna, a screen reader may read the card's name with German pronunciation.

## 2026-11-05 – Routes: confirm before loading, single streets; Area: streets and photos as two rows (accepted)
**Context.** Elena tried Routes. The search started by itself as soon as both points were set, unlike Area. Only long runs of road could be selected. The Area loading card had one row for streets and photos, the Routes card two.
**Decision (Elena).**
- *Confirm first:* both points set shows a preview, "This walk": start, end, straight-line distance, thermal window, **Analyse this walk** and Start again. Nothing is fetched or billed before Analyse, so a misclick costs nothing. Changes brief §3 and board Routes 2. This replaces "Automatic start" in the entry below.
- *Single streets:* a stretch is one street segment of the route, as a street in Area, not a run of segments in the same state. Changes brief §3. This replaces the merged names, the hardest-value rule and the photos spread over segments in the entry below: the card now shows that street's own value and photos, as in Area.
- *Area loading card:* separate rows for Streets and Street photos.
- *No "Finding the two ways" row:* finding them takes about 0.1 s after thermal, so the row was never seen active. Changes brief §3 and board Routes 2.
**Details (proposed).**
- *Words:* "Analyse this walk", echoing "Analyse this area". A clicked point shows its coordinates in the preview, a searched one its name. Cancel, and Back after an error, return to the preview; both points stay.
- *Swap:* in the preview it only swaps. With routes on the map it asks at once, since the same route either way round is already paid for (unless the season or time is new).
- *Bar:* one section per street, with the 2 px gap only where the state changes, so it reads as on the board. This differs from the brief's "2 px gaps between sections" for the route bars only. With many streets a section can be only about 4 px wide, so on a phone the map is the easier place to pick a street.
- *Keyboard:* the bar is one Tab stop, because a route can have 30 or more streets; the arrow keys go along it.
- *Dashes:* route B's dashes are drawn over runs of the same state, so the pattern does not restart at every short segment. A hovered or selected B street turns solid.
**Open (Elena).** Whether the streets being checked light up in teal while a route loads, as in Area. They would be candidates, not routes: 282 streets checked for 55 on the two ways on the first real route. For now the map stays plain, as in brief §3.
**Consequences.** One more click per route. A very short street (a few metres between two junctions) is its own stretch, so the count can be high: 35 on the first real route.

## 2026-11-05 – Routes: thermal only, up to 1.5 km, on the rated streets
**Context.** Elena asked for the Routes mode (boards Routes 1–4, P3). Rating is not built, so only Thermal has real data. A route needs a thermal run along its way, billed per tile. The brief and the boards also disagree on a few points.
**Decision (accepted, Elena).**
- *Thermal only for now:* the whole flow is built. B is the way with the least "hard" Thermal. Senses and Overall stay inactive, and "Rating for your profile" stays greyed. The API's route finder takes a state per segment, so rating can plug in.
- *Length (the board says about 3 km):* the walk may be up to 1.5 km and a run up to 8 tiles (`routes.max_walk_m`, `routes.max_jobs`). Both are in config.
- *Network (changes brief §6):* routes run on the rated street lines, not a separate sidewalk graph, so every stretch has its own colour, photo and card. The route does not say which side of a street to walk on or where to cross.
- *Routes 5, the 3D walk:* not built. The board contradicts brief §2 (no 3D buildings, flat view), and the brief does not describe it.
**Details (proposed).**
- *Finding the ways:* streets are read from an ellipse around start and end. Up to 8 tries find different ways at most 25% longer, each making the streets already used 1.4 × longer. Only streets within 40 m of those ways (the corridor) get photos and thermal comfort. On four real walks in Vienna (720–1,360 m in a straight line) that was 280–850 segments and 4–6 tiles. If the free `preview_area` says the corridor needs more than 8 tiles, the longest ways are dropped until it fits.
- *A and B:* A is the shortest. B is the best of a fixed set: Dijkstra with hard streets counted 0.5 to 8 × longer, plus the ways above, keeping those at most 25% longer. Best means the least hard, then the least mixed or no value, then the shortest. If that is A, B is the next shortest that differs along at least 10% of its length, labelled "alternative" (Elena: "next shortest" took two lines), not "easiest". If there is none, only A is shown. A no-value street counts like a mixed one, so a gap never looks easier than a known easy street. This is close to the best way, not proven the best (the exact problem is hard).
- *Gaps:* with sidewalks and crossings out of the data, a path can end a few metres short of a street. A dead end within 15 m of another street is joined by a short connector, which is added to the stretch before it. On real walks about one edge in six is a connector, so a route can occasionally cross something a person cannot (a fence, a low wall). Pedestrian areas mapped only as polygons are not walked through; streets and paths mapped across them are. Tunnels and underground passages stay out, as in the rated network.
- *The score on the server:* the brief has the backend find the routes, and the state decides B, so the app sends its limits in the request and `tool/thermal.py` applies the same rule as `lib/thermal.js`. A test keeps the two tables equal. The limits will become personal: they are used for the answer and not kept.
- *Automatic start (board Routes 2):* replaced the same day, see the entry above. A point more than 1.5 km from the other is refused before anything is asked.
- *Privacy:* start and end can be a home and a workplace. They travel in the POST body and are never logged. The cache (`runs/routes/`) has a hashed file name and holds no start or end, but its streets and middle point do show roughly where the way runs. The privacy notice should say so. The two ways are found again for each request, never stored.
- *Swap:* the cache key does not depend on the direction, so swapping start and end is not billed twice.
- *Season and time:* as in Area: free before both points are set, inactive while loading, then a new window asks again. The ways stay on the map until the new ones arrive, and if it fails they stay and the card says why. A new window can give a different B.
- *Stretch card:* it is the place card (brief §3, one card pattern), with the route bar above and coverage and previous / next below (these stay in view while the card scrolls). "Rate this place" waits for rating.
- *Verdict:* a plain sentence from rules, no AI: "B is 3 minutes longer but avoids the hot stretch on Goldschmiedgasse", or "the hot part of Rotenturmstraße" when B walks another part of that street. The board's "the open square and the market" needs Senses.
- *Screens:* a phone has no Ask or account button on Routes (board P3). Below 1200 px both panels stay, since Start and End are always needed; the left panel drops its explanations, the hint is hidden and the map uses the space below the panels if there is none between them. `/routes` and `/area` are one view, so the map stays when the tab changes, and each keeps its own state.
- *Speed:* with this many streets, building the segments took 249 s. `merge_short` and the alongside-road test now use a spatial index (under 2 s). On a real 300 m circle the old and new code gave identical segments.
**Alternatives.** The full sidewalk graph (more realistic directions, but each part must be matched to a street, which can go wrong at junctions). Thermal for the whole ellipse (up to about 30 tiles). Finding B in the browser (keeps the limits on the device, but the brief has the backend do it).
**Consequences.** A new route takes about 2.5 minutes before thermal on the public Overpass server, plus the simulation. Up to about 60–80 tokens per new route and season or time; cached after that. A walk whose shortest way is over 1.5 km is refused even if the straight line is shorter: a 1.2 km straight line can already be too long in the old town. First real run (Graben to Schwedenplatz, summer 15:00, 4 tiles, about 40 tokens): A 911 m, 36% hard; B 975 m, 7% hard. The ground materials were skipped after 20 s, as the 2026-11-04 entry allows, so that result rests on buildings and trees only.

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
**Consequences.** Underground passages (the U-Bahn station under Stephansplatz: 120 ways) are not rated. Routes run on these same lines, with no sidewalk graph (see 2026-11-05).

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
