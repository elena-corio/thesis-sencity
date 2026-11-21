<script setup>
// The end of a Senses card, for an area and for routes alike: what kind of rating this is, and the status line.
// Without a profile, the "Not personalised yet" box of board 2c with its shortcut to the onboarding.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { predictionLabel, runStatusLine } from '../lib/senses.js'
import { useProfileStore } from '../stores/profile.js'
import { useSensesStore } from '../stores/senses.js'
import { useAdjustStore } from '../stores/adjust.js'
import { adjustNote } from '../lib/adjust.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({ scope: { type: String, required: true } })
const senses = useSensesStore()
const profile = useProfileStore()
const router = useRouter()
const adjustments = useAdjustStore()
// Personal predictions only: general ones are never adjusted (lib/adjust.js).
const note = computed(() => (profile.personal ? adjustNote(adjustments.gap) : ''))
const run = computed(() => senses.runs[props.scope])
const rated = computed(() => (props.scope === 'area' ? senses.areaProgress : senses.routesProgress).rated)
const showStatus = computed(() => run.value.model && !['idle', 'rating'].includes(run.value.status))

function create() {
  profile.begin()
  router.push('/profile')
}
</script>

<template>
  <div class="senses-foot" data-testid="senses-foot">
    <p class="general">{{ predictionLabel(profile.personal, run.stale) }}</p>
    <p v-if="note" class="adjust-note" data-testid="adjust-note">{{ note }}</p>
    <div v-if="run.stale && profile.personal" class="stale" data-testid="senses-stale">
      <p>Your profile changed. These ratings are from before; they are rated again only when you ask.</p>
      <button type="button" class="btn btn-primary" @click="senses.rateAgain(scope)">Rate again with your profile</button>
    </div>
    <p v-if="showStatus" class="status" data-testid="senses-status">{{ runStatusLine(run, rated) }}</p>
    <div v-if="!profile.personal" class="not-yet" data-testid="not-personalised">
      <p class="not-yet-title"><AppIcon name="user" /> Not personalised yet</p>
      <p class="not-yet-text">Ratings for a general visitor.</p>
      <button type="button" class="btn btn-primary" @click="create">Create your profile</button>
    </div>
  </div>
</template>

<style scoped>
p { margin: 0; }
.senses-foot { margin-top: var(--space-4); padding-top: var(--space-4); border-top: var(--hairline) solid var(--line); }
.general { font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
.adjust-note { margin: 0; font-size: var(--fs-sm); color: var(--text-2); }
.status { margin-top: var(--space-2); font-size: var(--fs-xs); color: var(--text-muted); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.stale {
  margin-top: var(--space-3); padding: var(--space-3) var(--space-4); border: var(--hairline) solid var(--line);
  border-radius: var(--radius-btn); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2);
  font-size: var(--fs-sm); color: var(--text-2);
}
.not-yet {
  margin-top: var(--space-3); padding: var(--space-3) var(--space-4);
  border: var(--hairline) solid var(--line); border-radius: var(--radius-btn); background: var(--btn-selected-bg);
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2);
}
.not-yet-title { display: flex; align-items: center; gap: var(--space-2); font-weight: var(--fw-semibold); }
.not-yet-title :deep(.icon) { color: var(--mixed); }
.not-yet-text { font-size: var(--fs-sm); color: var(--text-2); }
</style>
