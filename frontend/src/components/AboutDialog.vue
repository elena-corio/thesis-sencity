<script setup>
// About and how to use (board 7, Elena 2026-11-16): opened from "?" (desktop), the account menu (phone and narrower
// screens) and every "How this works" link, which opens it at its section. The board's text is updated to the app as it
// is now (20 elements, no sign-in, no database, no 3D view). A modal on desktop, a full-screen sheet on a phone. Focus
// moves to the title (or the section asked for), stays inside, and goes back where it was; Esc closes it.
import { nextTick, onMounted, ref } from 'vue'
import { keyRows } from '../lib/legend.js'
import { useHelpStore } from '../stores/help.js'
import AppIcon from './AppIcon.vue'
import AppLogo from './AppLogo.vue'

defineProps({ phone: Boolean })
const help = useHelpStore()
const dialog = ref(null)
const body = ref(null)
const tipsReset = ref(false)

// The map legend's swatches: Easy, Mixed, Hard, Partial (Overall) and No photo (Senses and Overall).
const legend = keyRows('overall').map((r) => (r.id === 'none' ? keyRows('senses').at(-1) : r))

onMounted(async () => {
  await nextTick()
  const target = help.section ? dialog.value.querySelector(`#about-${help.section} h3`) : null
  if (target) {
    target.scrollIntoView({ block: 'start' })
    target.focus()
  } else {
    dialog.value.querySelector('#about-title')?.focus()
  }
})

function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    help.closeAbout()
  } else if (e.key === 'Tab') {
    // Keep Tab inside the dialog.
    const items = [...dialog.value.querySelectorAll('button, a[href]')].filter((el) => !el.disabled)
    const i = items.indexOf(document.activeElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); items.at(-1).focus() }
    else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus() }
  }
}
function showTipsAgain() {
  help.clearSeen()
  tipsReset.value = true
}
</script>

<template>
  <div class="backdrop" :class="{ phone }" @click.self="help.closeAbout()">
    <div ref="dialog" class="about panel" role="dialog" aria-modal="true" aria-labelledby="about-title"
         data-panel="about" @keydown="onKey">
      <header class="head">
        <span class="logo" aria-hidden="true"><AppLogo /></span>
        <div class="titles">
          <h2 id="about-title" tabindex="-1">How SenCity works</h2>
          <p class="sub">How places in Vienna may feel to your senses, before you go</p>
        </div>
        <button type="button" class="icon-btn close" aria-label="Close" @click="help.closeAbout()"><AppIcon name="close" /></button>
      </header>

      <div ref="body" class="body" data-scrollable>
        <section id="about-what" class="full" aria-labelledby="about-what-h">
          <h3 id="about-what-h" tabindex="-1">What SenCity does</h3>
          <p>SenCity checks how a street, park or square in Vienna may feel to your senses before you go. Choose an area
            to see its streets coloured easy, mixed or hard, or set a start and an end to compare two walking routes: A,
            the shortest, and B, the easiest, at most 25% longer. Open any street to see why, or walk along a route photo
            by photo.</p>
        </section>

        <section id="about-colours" class="full" aria-labelledby="about-colours-h">
          <h3 id="about-colours-h" tabindex="-1">How to read the colours</h3>
          <div class="legend">
            <ul class="swatches" aria-label="Map legend">
              <li v-for="r in legend" :key="r.id"><span class="swatch" :style="{ background: r.color }" aria-hidden="true" />{{ r.label }}</li>
            </ul>
            <p class="worse">Overall = the worse of thermal comfort and the photo rating</p>
          </div>
          <p>Easy, mixed and hard say how comfortable a place may feel. “No photo” means there is nothing to rate the
            street from yet; on Overall, “Partial” (faded colours) means only one of the two layers has a value. Senses
            rates each street from its photos, Thermal from its simulated feels-like temperature at the season and time you
            choose, and Overall shows the worse of the two: a street is easy only when both are.</p>
        </section>

        <div class="grid">
          <section id="about-ratings" aria-labelledby="about-ratings-h">
            <h3 id="about-ratings-h" tabindex="-1">Where ratings come from</h3>
            <p>An AI model looks at each street photo and predicts how comfortable it may feel, from 20 visible elements
              such as traffic, signs or shade. With your sensory profile the ratings are personal; without it they are
              general, for any visitor, marked “Not personalised yet”. Each one is a prediction, not a reason: it can be
              wrong, and you know your senses best.</p>
          </section>

          <section id="about-data" aria-labelledby="about-data-h">
            <h3 id="about-data-h" tabindex="-1">Your profile and data</h3>
            <p>Your profile is stored only in this browser: no account, nothing saved on a server. Under Profile you can
              download it, import it again or delete everything. For a personal rating, your answers (with your own words)
              and the photo go to an AI model on an EU endpoint, used only for that rating and not kept. Your own ratings
              of places and their notes, and your weather answers, never leave this device.</p>
          </section>

          <section id="about-weather" aria-labelledby="about-weather-h">
            <h3 id="about-weather-h" tabindex="-1">Weather and “feels like”</h3>
            <p>“Feels like” is how warm or cold the air feels to your body, from temperature, sun, wind and humidity
              together, simulated for the season and time you choose. Standard: 9 to 26 °C is easy, up to 32 °C or down to
              0 °C mixed, beyond that hard. If hot or cold weather is unpleasant for you, that side’s limits move by 1.5
              or 3 °C, and you can drag them on your profile. Your wind answer is kept but does not move the limits yet:
              wind is already part of “feels like”.</p>
          </section>

          <section id="about-photos" aria-labelledby="about-photos-h">
            <h3 id="about-photos-h" tabindex="-1">Photos</h3>
            <p>The photos come from Google Street View or Mapillary, each with its credit on the photo. A photo shows one
              moment: season, traffic, crowds, noise and smell may be different when you go. SenCity does not store the
              photos; they are fetched when you look at them.</p>
          </section>
        </div>

        <section id="about-limits" class="full limits" aria-labelledby="about-limits-h">
          <h3 id="about-limits-h" tabindex="-1">What SenCity does not do</h3>
          <ul>
            <li>It gives no medical or health advice.</li>
            <li>It does not measure noise, smell or air: it predicts from what a photo shows.</li>
            <li>Not every street has a photo, and thermal comfort is a simulation, not a measurement.</li>
            <li>The personal temperature limits are a first guess and not tested yet.</li>
          </ul>
        </section>
      </div>

      <footer class="foot">
        <p class="credit">Part of a master thesis final project</p>
        <div class="foot-actions">
          <button type="button" class="btn" data-testid="tips-again" @click="showTipsAgain">Show tips again</button>
          <button type="button" class="btn btn-primary" @click="help.closeAbout()">Got it</button>
        </div>
        <p class="visually-hidden" aria-live="polite">{{ tipsReset ? 'Tips will show again.' : '' }}</p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
p, h2, h3, ul { margin: 0; }
.backdrop {
  position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: var(--margin);
  background: var(--backdrop);
}
.about {
  width: min(100%, var(--about-w)); max-height: calc(100dvh - 2 * var(--margin));
  display: flex; flex-direction: column; overflow: hidden; text-align: left;
}
.head {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-5) var(--space-5) var(--space-4); border-bottom: var(--hairline) solid var(--line);
}
.logo { flex: none; color: var(--logo); display: grid; }
.logo :deep(svg) { width: var(--about-logo); height: var(--about-logo); }
.titles { flex: 1; min-width: 0; }
h2 { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
.sub { color: var(--text-2); font-size: var(--fs-sm); }
.close { align-self: flex-start; flex: none; }
.body {
  overflow-y: auto; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-5);
  overscroll-behavior: contain;
}
section { display: flex; flex-direction: column; gap: var(--space-2); scroll-margin-top: var(--space-4); }
h3 { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
section p, .limits li { font-size: var(--fs-sm); line-height: 1.55; color: var(--text-2); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5) calc(2 * var(--space-5)); }
.legend {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-5);
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-btn); border: var(--hairline) solid var(--line);
}
.swatches { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); font-size: var(--fs-sm); }
.swatches li { display: flex; align-items: center; gap: var(--space-2); }
.swatch { flex: none; width: var(--space-4); height: var(--swatch-h); border-radius: var(--radius-pill); }
.worse { font-size: var(--fs-xs); color: var(--text-2); }
.limits ul { padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); }
.foot {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3);
  padding: var(--space-4) var(--space-5); border-top: var(--hairline) solid var(--line);
}
.credit { font-size: var(--fs-xs); color: var(--text-muted); }
.foot-actions { display: flex; gap: var(--space-3); flex-wrap: wrap; }

/* Phone: a full-screen sheet. */
.phone { padding: 0; place-items: stretch; }
.phone .about { width: 100%; max-height: none; height: 100dvh; border-radius: 0; border: 0; }
.phone .head { padding: var(--space-4); }
.phone .body { padding: var(--space-4); }
.phone .grid { grid-template-columns: 1fr; gap: var(--space-5); }
.phone .foot { padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom)); }
.phone .foot-actions { width: 100%; }
.phone .foot-actions .btn { flex: 1; }
@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
