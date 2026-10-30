// The scroll behaviour for a script-driven scroll: smooth, unless the person
// has asked their system for less motion. CSS cannot reach these -- theme.css
// sets `scroll-behavior: auto` under prefers-reduced-motion, but an explicit
// `behavior: 'smooth'` passed to scrollIntoView or scrollTo overrides it.
export function smoothScroll(): ScrollBehavior {
  if (typeof window === 'undefined') return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}
