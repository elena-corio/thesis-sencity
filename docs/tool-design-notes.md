# SenCity tool – design decisions (25 Oct 2026)

Mockups: Design canvas "SenCity app – dark views" (8 screens). Dark first; light mode to follow (Elena's usual mode).

## Flow
Welcome → Sign in / create account (email sign-in link, no password; or continue without an account, saved on this device only) → Onboarding → Profile → Save and go to map (Loading) → Map.
Returning user: Welcome → Sign in → Map. Profile tab with no profile yet → empty state with "Create your profile" → Onboarding; until then the map shows general ratings: Senses from the default model (V0), thermal with the standard limits, a "Not personalised yet" card with a "Create your profile" shortcut, and "Senses · general" on the legend and place cards.

## Screens
1. **Map – Thermal** (main). 3D Infrared.city map with floating panels:
   - top left: logo + search in one bar
   - top centre: tabs Map / Compare / Profile
   - top right, one bar: About (?), Print, light/dark, Ask (opens chat), account (profile, log out)
   - left panel: layer (Thermal / Senses / Overall, one at a time), legend, personal note, place filters
   - season chips + short time slider in the left panel under the layer (only for Thermal and Overall; no bottom bar since 2026-11-07)
   - bottom right, fixed: zoom +/−, top view
   - place card on click: square photo (click to enlarge, small icon), name, type, overall box ("hard because of heat (or cold)"), thermal and photo rating, might bother / might feel good with sense icons, "Based on N photos within 100 m. A prediction for your profile, not a reason." Scores: an Overall headline with no bar ("Hard · overall, because of heat (or cold)"), then two 1–5 bars, Thermal and Senses (pink→amber→cyan gradient, diamond at the score); the bar of the layer selected on the left is highlighted, and on Overall the bar that decided it.
   - selected-place marker: white dot + one thin ring
2. **Map – Senses + chat.** Streets coloured by their nearest photo's rating (easy / mixed / hard); streets with no photo stay unlit. Chat panel on the right, above the map controls, scrolls; suggestions show a square photo + state dot and are marked on the map.
3. **Compare.** Start / End (routes only; comparing two areas is dropped for phase 1), "Colour the routes by" (Thermal / Senses / Overall). Routes on the map coloured by state along their length (A continuous, B dashed). Panel: Route A / Route B toggle buttons (show/hide), one bar per route labelled with the chosen layer, km + min, share "hard", one-line verdict, coverage ("based on photos along 80% of A…"), hover a bar section to find it on the map.
   Routes: the user picks only Start and End (both marked on the map). The backend computes two walking routes: A = shortest, B = the easiest (least share of "hard" on the chosen layer) at most 25% longer; if that is the same as A, B = the second shortest. Buttons "A · shortest" / "B · easiest". Bars ~200 px wide, opaque state colours.
4. **Onboarding.** Part A as in the survey (with our wording changes): 1–5 grids, one block per card, sense icon per row, progress, privacy line. Plain dark background. If personas don't work (H2), becomes a short label form.
5. **Profile.** Radar of the 8 senses on circular rings, directly on the background (no box): what bothers (pink) and what feels good (cyan), 1–5; sense icons instead of names, name on hover (small tooltip). Right panel: own words, strongest items, personal thermal limits (heat and cold), "Places that may suit you" (3 square photos), buttons "Edit answers" / "Save and go to map".
6. **Loading.** Logo animation: each line draws along its curve, one per sector at a time (top S, bottom S, C), inside to outside, then all fade; C draws anticlockwise from the top. Shown after "Save and go to map" while photos are rated; small version while the chat answers. Respect reduced motion in the real app (static logo).
7. **About.** Dialog over the dimmed app (overlay 80%, panels still visible but inactive): 4 steps (profile, street photos, thermal, compare), legend, "Good to know" (predictions not reasons, one moment, unlit streets, data private and deletable), thesis credit and contact (no IAAC).
9. **Welcome** – logo, "How will this place feel for you?", one-line explanation, 3 steps, Create your profile / Sign in, privacy + thesis line. Map faded in on the right.
10. **Sign in / create account** – email sign-in link (no password), New account / Sign in toggle, privacy note, "Continue without an account".
11. **Profile, empty** – faint empty radar, "You don't have a profile yet", Create your profile; map shows thermal only until then.
8. **Print report (A4, light).** Dark-teal logo, radar + own words + strongest, one place with photo and ratings, route comparison, "How this was made". Must work in grayscale (dashed / striped).

## Calibration (H3)
- Place card: "Rate this place" 1–5 from the photo, then (optional) what bothers / feels good. Hint: "From the photo. It tunes your profile." (UI never says "persona": use "your profile" or "your predictions")
- Own ratings are added to the persona prompt as examples (V2+: up to 5, one per place type, never the photo being predicted). They also feed "how reliable the persona has been for you".
- Without a profile, ratings are kept and used once the profile exists.
- If H3 is not supported, ratings only update the reliability line.

## Layers (one at a time)
- **Thermal** (formerly Heat; covers hot and cold) – Infrared.city UTCI ("feels like" °C), chosen season/time, as three levels (brief §4; no 1–5 score): 9–26 °C easy, 26–32 or −13–9 mixed (0–9 °C is mixed), above 32 or below −13 hard; the card shows a temperature bar. Personal limits: heat limits 3 °C lower if direct sun and heat bother a lot (A13), cold limits 3 °C higher if cold bothers a lot (tool-only item); sliders in the profile; untested. Legend: "Feels like, hot or cold".
- **Senses** – photo ratings by the persona as coloured street stretches. Thermal is NOT taken from photos in the tool (a photo shows one moment's weather); it stays in the study as is.
- **Overall** – per street segment: thermal comfort is projected onto the streets (75th percentile of thermal comfort sampled along each ~50 m segment, where people walk), overall = worse of Thermal and Senses; the card says which decided it ("set by thermal"). Segments with no photo stay unlit. The Thermal layer is drawn street by street too (every street has a temperature, so none is unlit). Canvas boards 2b and 2e.
- Dropped: wind (no wind question among the 8 senses), green, "you vs generic visitor".
- Map shows 3 states; the card shows the 1–5 number for Senses and a temperature bar for Thermal.

## Interaction
- **Linked highlighting on hover:** hovering something highlights everything related to it, everywhere on screen. Examples:
  - a place card or chat suggestion ↔ its marker and street stretch on the map
  - a section of a Compare bar ↔ that stretch of the route on the map (and back)
  - a legend item (easy / mixed / hard) ↔ all matching streets, others dim
  - a sense icon on the radar ↔ its tooltip with both values, and its rows in "strongest" and the place card
  - a layer button ↔ preview of that layer's legend
  - a Route A / B button ↔ that route on the map
  Highlight = full opacity + light outline; everything else dims slightly. Calm transitions (~150 ms), no motion when reduced motion is on.
- Selected state everywhere: filled + light outline (tabs, layer buttons, toggles, chips).

## Style
- Dark first, light also. Dark teal (#13232a ground, #162730 panels, #2b4a52 borders), not black. No neon, no glows.
- Floating rounded panels over a calm map (refs: vitru.views, sen.city, digital.tissue). Sensi only for principles (conversational onboarding, scores with explanation, profile on the background).
- Colour carries meaning only: cyan #40c5e8 = easy, amber #faa81e = mixed, pink #c2306a = hard (darker for colour-blind safety; no stripes; the state is always written; print uses light-to-dark versions so it reads in grayscale). UI in teal shades. Senses = icons, not colours.
- Font: Inter only. Section titles sentence case, semibold 14px. Tabular figures for numbers.
- Logo: white on dark, dark teal on light/print; used in the top bar and the loading animation.
- Photos are square (Street View, credit Google).
- Sensory-friendly: low saturation, no motion by default, large text, good contrast.

## Thesis doc to add
- Tool: the thermal sense comes from simulation, not photos (photos show one moment's weather).
- Limitations: the personal thermal limits are untested personalisation; validation is future work.
