import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { answerText, anyAnswered, cleanPrepare, emptyPrepare, isAnswered, offersFor, scoreOf, toggle } from './prepare.js'

// How you prepare for new places, from config/prepare.json (as GET /api/profile/survey sends it).
const DEF = JSON.parse(readFileSync(new URL('../../../config/prepare.json', import.meta.url), 'utf-8'))

describe('the questions', () => {
  it('are Q1 (A15), Q2, Q3 and Q4, English only, with the words Elena gave', () => {
    expect(DEF.questions.map((q) => [q.code, q.type])).toEqual([['Q1', 'scale_1_5'], ['Q2', 'multi'], ['Q3', 'scale_1_5'], ['Q4', 'multi']])
    expect(DEF.questions[0].source).toBe('A15')
    expect(DEF.questions[0].title.en).toBe("How comfortable do you feel going to a place you don't know?")
    expect(DEF.questions[2].title.en).toBe('How often does a place feel like too much for your senses?')
    expect(DEF.questions[2].labels).toEqual({ 1: { en: 'Never' }, 5: { en: 'Very often' } })
    const { about: _about, ...shown } = DEF // the note for developers names the thesis repo; the rest is what the app shows
    expect(JSON.stringify(shown)).not.toMatch(/"it"|persona/i)
  })

  it('map every Q2 option to what the app can offer, Other to nothing', () => {
    const q2 = DEF.questions[1]
    expect(Object.fromEntries(q2.options.map((o) => [o.code, o.offers]))).toEqual({
      look_at_photos: ['place_photo'], check_busy: ['crowds_quieter'], quieter_time: ['best_time'], calmer_route: ['route_senses'],
      rest_places: ['rest_places'], bring_something: ['take_with_you'], go_with_someone: ['share_card'],
      dont_prepare: ['short_summary'], other: [],
    })
    for (const o of q2.options) for (const x of o.offers) expect(DEF.offers[x].en).toBeTruthy()
  })
})

describe('the answers', () => {
  it('tick and untick; an exclusive option clears the others and is cleared by them', () => {
    let a = toggle(DEF, 'Q2', emptyPrepare().Q2, 'look_at_photos')
    a = toggle(DEF, 'Q2', a, 'calmer_route')
    expect(a.ticked).toEqual(['look_at_photos', 'calmer_route'])
    a = toggle(DEF, 'Q2', a, 'dont_prepare')
    expect(a.ticked).toEqual(['dont_prepare'])
    a = toggle(DEF, 'Q2', a, 'go_with_someone')
    expect(a.ticked).toEqual(['go_with_someone'])
    a = toggle(DEF, 'Q2', a, 'go_with_someone')
    expect(a.ticked).toEqual([])
    const q4 = toggle(DEF, 'Q4', toggle(DEF, 'Q4', null, 'sit_rest'), 'nothing_helps')
    expect(q4.ticked).toEqual(['nothing_helps'])
  })

  it('keep "Other" text only with Other ticked', () => {
    const a = toggle(DEF, 'Q2', { ticked: ['other'], other: 'a map' }, 'other')
    expect(a).toEqual({ ticked: [], other: '' })
  })

  it('are cleaned: unknown codes dropped, an exclusive option alone, the text trimmed and cut', () => {
    const c = cleanPrepare(DEF, {
      Q1: 7, Q2: { ticked: ['nope', 'calmer_route', 'other'], other: `  ${'x'.repeat(300)}  ` },
      Q3: 'often', Q4: { ticked: ['sit_rest', 'nothing_helps'], other: 'kept?' }, A11: 3,
    })
    expect(c.Q1).toBe(null)
    expect(c.Q2.ticked).toEqual(['calmer_route', 'other'])
    expect(c.Q2.other).toHaveLength(DEF.other_max)
    expect(c.Q3).toBe(null)
    expect(c.Q4).toEqual({ ticked: ['nothing_helps'], other: '' })
    expect(c).not.toHaveProperty('A11')
    expect(cleanPrepare(DEF, null)).toEqual(emptyPrepare())
  })

  it('read as words on "Your profile"', () => {
    const a = cleanPrepare(DEF, { Q1: 5, Q2: { ticked: ['rest_places', 'other'], other: 'toilets' }, Q3: 3 })
    expect(answerText(DEF, a, 'Q1')).toBe('Very much (5)')
    expect(answerText(DEF, a, 'Q2')).toBe('Know where I can rest or step away; Other: toilets')
    expect(answerText(DEF, a, 'Q3')).toBe('3')
    expect(answerText(DEF, { Q3: 5 }, 'Q3')).toBe('Very often (5)')
    expect(answerText(DEF, { Q3: 1 }, 'Q3')).toBe('Never (1)')
    expect(answerText(DEF, a, 'Q4')).toBe('')
    expect(isAnswered(DEF, a, 'Q4')).toBe(false)
    expect(anyAnswered(DEF, a)).toBe(true)
    expect(anyAnswered(DEF, emptyPrepare())).toBe(false)
  })

  it('in the old form (Q3 as a word) count as unanswered, never converted', () => {
    const old = { Q1: 4, Q3: 'often' }
    expect(isAnswered(DEF, old, 'Q3')).toBe(false)
    expect(answerText(DEF, old, 'Q3')).toBe('')
    expect(scoreOf(old, 'Q3')).toBe(null)
    expect(cleanPrepare(DEF, old).Q3).toBe(null)
    expect(isAnswered(DEF, old, 'Q1')).toBe(true)
  })

  it('give what the app can offer first, in the file\'s order, each once', () => {
    const a = { Q2: { ticked: ['go_with_someone', 'look_at_photos', 'other'] } }
    expect(offersFor(DEF, a)).toEqual(['place_photo', 'share_card'])
    expect(offersFor(DEF, {})).toEqual([])
  })
})
