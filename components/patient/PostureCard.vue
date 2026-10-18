<script setup lang="ts">
import { postureHeadline, VIEW_LABELS, type Points, type PostureView, type ViewMetrics } from '../../utils/posture'

// "Mi postura" on the patient's home, in the app and the portal: the first
// and the latest assessment their practitioner shared, side by side, and the
// number that explains itself -- how much their head weighs on the neck.
// Nothing at all until one is shared. Shared with mobile/.
const t = useT()
const authedFetch = useAuthedFetch()

interface View { url: string | null; width: number; height: number; points: Points; facing: 'right' | 'left' | null }
interface Assessment { id: string; takenAt: string; metrics: Partial<Record<PostureView, ViewMetrics>>; views: Partial<Record<PostureView, View>> }
const list = ref<Assessment[]>([])
onMounted(async () => {
  try {
    list.value = (await authedFetch<{ assessments: Assessment[] }>('/api/portal/posture')).assessments
  } catch {
    list.value = []
  }
})

const first = computed(() => list.value[0] ?? null)
const latest = computed(() => list.value[list.value.length - 1] ?? null)
const pair = computed(() => (list.value.length > 1 ? [first.value!, latest.value!] : latest.value ? [latest.value] : []))
const views = computed(() => (['right', 'left', 'front', 'back'] as PostureView[]).filter((v) => pair.value.length && pair.value.every((a) => a.views[v]?.url)))
const view = ref<PostureView>('right')
watch(views, (vs) => {
  if (vs.length && !vs.includes(view.value)) view.value = vs[0]!
}, { immediate: true })
const now = computed(() => (latest.value ? postureHeadline(latest.value.metrics) : null))
const then = computed(() => (list.value.length > 1 && first.value ? postureHeadline(first.value.metrics) : null))
const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const kg = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('es-ES')} kg`)
</script>

<template>
  <section v-if="latest" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4" data-cy="patient-posture">
    <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('My posture', 'Mi postura') }}</h2>
    <div v-if="now?.headWeight" class="flex items-baseline gap-2">
      <span class="font-mono text-[28px] font-semibold text-ink-900" data-cy="patient-posture-weight">{{ kg(now.headWeight) }}</span>
      <span class="text-[13px] text-ink-muted">{{ t('on your neck', 'sobre tu cuello') }}</span>
    </div>
    <p v-if="then?.headWeight && now?.headWeight" class="text-[13.5px] text-ink-700">
      {{ t(`On ${day(first!.takenAt)} it was ${kg(then.headWeight)}.`, `El ${day(first!.takenAt)} eran ${kg(then.headWeight)}.`) }}
      <template v-if="now.headWeight < then.headWeight">{{ t('Your head sits more upright.', 'Tu cabeza está más alineada.') }}</template>
    </p>
    <div v-if="views.length > 1" class="flex flex-wrap gap-1.5" role="group" :aria-label="t('View', 'Vista')">
      <button v-for="v in views" :key="v" type="button" class="h-9 rounded-pill border px-3 text-[13px] font-semibold" :class="view === v ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'" :aria-pressed="view === v" @click="view = v">{{ VIEW_LABELS[v] }}</button>
    </div>
    <div v-if="views.length" class="grid gap-2" :class="pair.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
      <figure v-for="a in pair" :key="a.id" class="m-0 flex flex-col gap-1">
        <PostureOverlay :src="a.views[view]!.url!" :width="a.views[view]!.width" :height="a.views[view]!.height" :view="view" :points="a.views[view]!.points" :labels="false" />
        <figcaption class="text-center text-[12px] text-ink-muted">{{ day(a.takenAt) }}</figcaption>
      </figure>
    </div>
    <p class="text-[12px] text-ink-muted">{{ t('The blue line is the vertical: the closer to it, the less load. An estimate to explain, not a diagnosis.', 'La línea azul es la vertical: cuanto más cerca, menos carga. Una estimación para explicar, no un diagnóstico.') }}</p>
  </section>
</template>
