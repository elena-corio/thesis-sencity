// Frontend settings that are not visual. Colours, fonts and sizes live in styles/style.css.

export default {
  radius: {
    min: 50, // a smaller circle snaps to this (m)
    max: 500, // hard maximum (m)
    default: 200, // when a radius is needed without the pointer (keyboard, search)
    rounding: 10, // chip value and stored radius are rounded to this (m)
    keyboardStep: 10, // arrow keys (m)
    presets: [100, 200, 500], // the Radius choice in the area inputs (m); 200 is the default, 500 the maximum
  },
  circlePoints: 64,

  // Start view: Stephansplatz, Vienna. Any location can be selected (brief §3).
  start: { lat: 48.2085, lon: 16.3721, zoom: 16 },

  mapStyles: {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/positron', // the same map, in dark colours: see map/base.js
  },

  // "About N street photos" before loading: a cheap estimate, no API calls.
  // Kept photos per km² from the Stephansplatz 200 m run (234 photos in 0.126 km²).
  photosPerKm2: 1860,

  // Whether a layer needs the billed thermal run. Photos always load; the Thermal layer skips ratings.
  layers: {
    senses: { thermal: false },
    thermal: { thermal: true },
    overall: { thermal: true },
  },
  // The layer Area and Routes open on.
  layerDefault: 'senses',

  // The app's language: which label of model/app_v9/elements.json is shown ('en' or 'it').
  language: 'en',
  // The words of a comfort rating of 2, 3 and 4. Those of 1 and 5 are the survey's, from model/app_v9/.
  comfortWords: { 2: 'not very comfortable', 3: 'somewhat comfortable', 4: 'fairly comfortable' },
  // The recommendations in Senses (lib/senses.js): how many to list, and at least this far apart (between middles),
  // so one long street does not fill the list.
  sensesRecommend: { count: 3, minApartM: 75 },

  // Thermal window shown before analysis (brief §6, Infrared.city windows).
  thermalDefault: { season: 'summer', time: '15:00' },
  // Thermal limits, the standard ones: every one lives here, and lib/thermal.js reads them (thermalLimits() gives the
  // ones in use: personal with a profile's weather answers, else these). Feels-like °C, from the UTCI stress categories.
  // Easy from cold[0] to heat[0] (no thermal stress); mixed from heat[0] to heat[1] (moderate heat) or cold[1] to
  // cold[0] (slight cold, 0–9 °C); hard above heat[1] or below cold[1]. Cold is hard from below 0 °C (moderate cold
  // stress; Elena, 2026-11-15): stricter than grouping the UTCI categories (which would start hard at −13), for
  // sensory-sensitive people, and untested. Thermal has no 1–5 score, only these three levels. The comfort target is the
  // middle of the easy range in use: (9 + 26) / 2 = 17.5 °C here.
  thermalLimits: { heat: [26, 32], cold: [9, 0] },
  // Personal limits from the Weather step (Elena, 2026-11-15): hot weather answered 1 moves both heat limits down by
  // 3 °C, 2 by 1.5 °C; cold weather 1 moves both cold limits up by 3 °C, 2 by 1.5 °C; 3–5 keep the standard bands.
  // On the profile's bar the start of hot and of cold can be dragged in steps of `step` °C, keeping the easy range at
  // least `minEasy` °C wide.
  thermalPersonal: { shift: { 1: 3, 2: 1.5 }, step: 0.5, minEasy: 2 },
  // The temperature bars (the place card's, and the profile's comfortable temperature): their ends (°C), −10 to 45, so the
  // standard easy range 9–26 sits in the middle (Elena, 2026-11-15). Heat side from cold[0] to max, cold side from min to
  // heat[0], both sides from min to max; a value beyond an end sits at that end, as an arrow pointing out.
  thermalBar: { min: -10, max: 45 },
  // Walking speed for "2 min away" on the place card (about 4.8 km/h).
  walkMetresPerMinute: 80,
  // "Cooler street nearby" on the place card (lib/nearby.js): only streets within maxM (straight line
  // between the middles of the two stretches); going there zooms in up to `zoom`.
  nearby: { maxM: 300, zoom: 17 },
  // "Likely easiest for you" on the Thermal layer (lib/suggest.js): at most `count` places, each at
  // least minApartM from the others (between middles); places whose distance from the comfort target
  // differs by at most `margin` °C count as close, and then a type not picked yet goes first.
  suggest: { count: 3, minApartM: 150, margin: 1 },
  // Wait this long after the last season or time change before asking for it (each new one is billed).
  thermalDebounceMs: 700,
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  // Hours on the time slider (whole hours, local standard time of the weather file).
  thermalHours: { min: 9, max: 21 },

  // Phone sheet: when the map re-fits after a change of height (just after the transition), and dragging:
  // startPx before it counts as a drag, minPx to open or minimise.
  sheetSettleMs: 220,
  sheetDrag: { startPx: 6, minPx: 40 },

  // Routes (brief §3): the limits of the API (config/tool.yaml, routes), checked here before asking.
  routes: {
    minM: 50, // start and end closer than this are not a route
    maxM: 1500, // straight line, and the longest walk
  },

  // Walk along a route (board Routes 5): at street level, eyes eyeHeightM above the start of each stretch, looking
  // along it and a little down (pitch 84: 6° below the horizon, so the route ahead shows). maxZoom: a camera this
  // low is past the map's usual 22. Play goes on to the next stretch every stretchMs; it glides there in glideMs,
  // or jumps with reduced motion. A route's walk opens paused. A stretch with several photos (Street View: one every 10 to
  // 20 m, Elena 2026-11-16) shares its stretchMs between them, each shown at least photoMinMs.
  // miniZoom: the "Where you are" map on the right.
  walk: { glideMs: 600, stretchMs: 8000, photoMinMs: 2000, miniZoom: 16 },

  // Street photos (lib/photos.js). Where they come from is PHOTO_SOURCE, on the server (Elena, 2026-11-16). shown: false
  // shows none anywhere (they are still found and rated). streetviewUsd: one Street View image at list price, for the cost
  // counter in development only (as streetview.price_per_1000_images_usd in config/tool.yaml).
  photos: { shown: true, streetviewUsd: 0.007 },

  // SenCity API. Empty = same origin (/api, proxied by Vite in development).
  apiBase: import.meta.env.VITE_API_BASE ?? '',

  // Search (brief §3): suggestions while typing, through the API (Photon).
  search: {
    minChars: 3,
    debounceMs: 300,
    placeZoom: 17, // zoom for a result without an extent (an address, a stop)
    maxZoom: 18, // never zoom in further than this for a street or area
  },
}
