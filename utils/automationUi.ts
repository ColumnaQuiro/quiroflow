// Control classes shared by the Automations panels, so every input, select
// and segmented choice in the inspector is the same size: 36px under a mouse,
// 44px on a touch screen (the `touch:` variant), compact chips 32px.

export const FIELD =
  'h-9 w-full min-w-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60 touch:h-11'
export const FIELD_NUMBER =
  'h-9 w-20 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11'
export const LABEL = 'flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-700'
export const HINT = 'text-[12px] leading-snug text-ink-muted'
export const SECTION = 'text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint'
export const SEGMENT_WRAP = 'inline-flex rounded-ctl border border-line-control bg-surface p-0.5'
export const segmentBtn = (active: boolean) =>
  `h-8 rounded-ctlSm px-3 text-[12.5px] font-semibold touch:h-10 ${active ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:text-ink-700'}`
export const REMOVE_BTN =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-danger-text touch:h-11 touch:w-11'
export const LINK_BTN = 'self-start text-[12.5px] font-semibold text-brand-text hover:underline touch:min-h-11'
export const NOTE = 'rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[12.5px] leading-snug text-ink-500'
export const WARN = 'rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] leading-snug text-warning-text'
