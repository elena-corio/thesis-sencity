import { AUTH_ON } from './auth.js'
// The Weather step of the onboarding (Elena, 2026-11-15): hot, cold and windy weather outdoors, each on the Part A scale
// (1 very unpleasant … 5 very pleasant). Not part of the survey export, so the words live here, in English and Italian.
// The answers stay on this device with the profile; they set the personal Thermal limits (lib/thermal.js) and never
// enter the profile text or a model call.

export const WEATHER = {
  code: 'weather',
  title: {
    en: 'Outdoors, how pleasant or unpleasant is this weather for you?',
    it: 'All’aperto, quanto è piacevole o spiacevole per te questo tempo?',
  },
  note: {
    en: AUTH_ON ? 'Used only for the Thermal layer. It is not sent to the model.' : 'Used only for the Thermal layer, on this device. It is not sent to the model.',
    it: 'Usato solo per il livello termico, su questo dispositivo. Non viene inviato al modello.',
  },
  rows: [
    { code: 'hot', icon: 'sun', en: 'Hot weather', it: 'Caldo' },
    { code: 'cold', icon: 'snowflake', en: 'Cold weather', it: 'Freddo' },
    { code: 'wind', icon: 'wind', en: 'Windy weather', it: 'Vento' },
  ],
}
export const WEATHER_CODES = WEATHER.rows.map((r) => r.code)

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5

/** The weather answers kept: only hot, cold and wind, each 1–5; any other value is dropped. */
export function cleanWeather(w) {
  const out = {}
  for (const c of WEATHER_CODES) if (isScore(w?.[c])) out[c] = w[c]
  return out
}

/** Wind bothers this person (1–2): the windy-corner flag is shown prominently where the app has one. */
export const windSensitive = (w) => isScore(w?.wind) && w.wind <= 2
