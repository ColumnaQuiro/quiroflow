<script setup lang="ts">
// A practitioner's initials in their calendar colour: on each block of the
// whole-clinic tab, and on that practitioner's tab, which is what makes the
// tab bar the legend for the grid.
//
// team_members.color is data, so the fill is that colour mixed a third of
// the way toward the ink token: darker in light mode, under a white label;
// lighter in dark mode, under the dark one (--color-on-fill flips with the
// theme). Unmixed, half the palette -- amber, lime, sky, green -- left a
// white letter near 2:1.
//
// No colour means no practitioner: a dashed outline with a "?", so a visit
// nobody is down for stands out on the whole-clinic tab rather than blending
// in.

const props = withDefaults(
  defineProps<{
    /** From practitionerBadgeLabels: "L", or "LM" where L alone is ambiguous. */
    initials: string
    color: string | null
    /** The full name, for the tooltip. Null: the visit has no practitioner. */
    name: string | null
    size?: 'sm' | 'md'
  }>(),
  { size: 'sm' },
)

const t = useT()

const fill = computed(() => (props.color ? { background: `color-mix(in srgb, ${props.color} 66%, rgb(var(--color-ink-900)))` } : {}))
const title = computed(() => props.name ?? t('No practitioner', 'Sin profesional'))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none"
    :class="[
      size === 'md' ? 'h-[18px] min-w-[18px] px-[4px]' : 'h-[14px] min-w-[14px] px-[3px]',
      color ? 'text-brand-on' : 'border border-dashed border-line-control text-ink-muted',
    ]"
    :style="fill"
    :title="title"
    data-cy="practitioner-badge"
  >{{ color ? initials : '?' }}</span>
</template>
