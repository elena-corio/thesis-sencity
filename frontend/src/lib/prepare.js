// How you prepare for new places: the optional step after the profile (config/prepare.json, sent with
// GET /api/profile/survey as `prepare`; no words are written here). The answers stay on this device with the profile,
// like the weather: never in a rating request (lib/profile.js PROMPT_CODES) and never in a prompt.
//
// Answers: { Q1: 1–5 | null, Q2: { ticked: [code], other: '' }, Q3: code | null, Q4: { ticked: [code], other: '' } }.

const isScore = (v) => Number.isInteger(v) && v >= 1 && v <= 5
const question = (def, code) => def?.questions?.find((q) => q.code === code) ?? null

/** No answer yet. */
export const emptyPrepare = () => ({ Q1: null, Q2: { ticked: [], other: '' }, Q3: null, Q4: { ticked: [], other: '' } })

/** The answers kept: known codes only, an exclusive option alone, "Other" text only with Other ticked, trimmed. */
export function cleanPrepare(def, answers) {
  const out = emptyPrepare()
  if (!def || !answers || typeof answers !== 'object') return out
  for (const q of def.questions) {
    const a = answers[q.code]
    if (q.type === 'scale_1_5') out[q.code] = isScore(a) ? a : null
    else if (q.type === 'single') out[q.code] = q.options.some((o) => o.code === a) ? a : null
    else {
      const codes = new Set(Array.isArray(a?.ticked) ? a.ticked : [])
      let ticked = q.options.filter((o) => codes.has(o.code)).map((o) => o.code)
      const alone = q.options.find((o) => o.exclusive && ticked.includes(o.code))
      if (alone) ticked = [alone.code]
      const other = q.options.find((o) => o.other)
      const text = typeof a?.other === 'string' ? a.other.trim().slice(0, def.other_max) : ''
      out[q.code] = { ticked, other: other && ticked.includes(other.code) ? text : '' }
    }
  }
  return out
}

/** Tick or untick one option: an exclusive option ("I don't usually prepare", "Nothing really helps") clears the others,
 *  and ticking another clears it. Returns the new answer for that question. */
export function toggle(def, code, answer, option) {
  const q = question(def, code)
  const ticked = new Set(answer?.ticked ?? [])
  const o = q.options.find((x) => x.code === option)
  if (ticked.has(option)) ticked.delete(option)
  else if (o.exclusive) { ticked.clear(); ticked.add(option) } else {
    for (const x of q.options) if (x.exclusive) ticked.delete(x.code)
    ticked.add(option)
  }
  const list = q.options.filter((x) => ticked.has(x.code)).map((x) => x.code)
  const other = q.options.find((x) => x.other)
  return { ticked: list, other: other && list.includes(other.code) ? (answer?.other ?? '') : '' }
}

/** Has this question an answer? */
export function isAnswered(def, answers, code) {
  const q = question(def, code)
  const a = answers?.[code]
  if (!q) return false
  if (q.type === 'multi') return (a?.ticked?.length ?? 0) > 0
  return a != null
}

/** Any answer at all: the step was started. */
export const anyAnswered = (def, answers) => !!def && def.questions.some((q) => isAnswered(def, answers, q.code))

/** The words of an answer, for "Your profile": "Very much (5)", "Often", "Plan a calmer route; Other: …". */
export function answerText(def, answers, code) {
  const q = question(def, code)
  const a = answers?.[code]
  if (!q || !isAnswered(def, answers, code)) return ''
  if (q.type === 'scale_1_5') return q.labels[String(a)] ? `${q.labels[String(a)].en} (${a})` : String(a)
  if (q.type === 'single') return q.options.find((o) => o.code === a)?.en ?? ''
  return q.options.filter((o) => a.ticked.includes(o.code))
    .map((o) => (o.other && a.other ? `${o.en}: ${a.other}` : o.en)).join('; ')
}

/** What the app can offer first, from Q2: the offer codes of the ticked options, in the file's order, each once. */
export function offersFor(def, answers) {
  const ticked = new Set(answers?.Q2?.ticked ?? [])
  const out = []
  for (const o of question(def, 'Q2')?.options ?? []) if (ticked.has(o.code)) for (const x of o.offers ?? []) if (!out.includes(x)) out.push(x)
  return out
}
