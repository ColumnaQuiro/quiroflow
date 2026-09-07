<script setup lang="ts">
defineProps<{ title: string; lead?: string }>()
</script>

<template>
  <article class="max-w-[740px]">
    <h1 class="text-[26px] font-[620] tracking-tightTitle text-ink-900">{{ title }}</h1>
    <p v-if="lead" class="mt-2 text-[14.5px] leading-relaxed text-ink-muted2">{{ lead }}</p>
    <div class="dp-prose mt-7">
      <slot />
    </div>
  </article>
</template>

<style>
/* Prose styling for the portal's authored copy. Deliberately plain CSS
   against the app's theme variables rather than Tailwind classes repeated on
   every heading and paragraph across ten documentation pages -- and not
   scoped, because these rules have to reach the markup each page passes in
   through the default slot. Colours come from assets/css/theme.css so the
   portal follows the same light/dark palette as the app. */
.dp-prose > h2 {
  margin-top: 2.25rem;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.012em;
  color: rgb(var(--color-ink-900));
  scroll-margin-top: 5rem;
}
.dp-prose > h2:first-child {
  margin-top: 0;
}
.dp-prose > h3 {
  margin-top: 1.6rem;
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--color-ink-800));
}
.dp-prose > p,
.dp-prose > ul,
.dp-prose > ol {
  margin-top: 0.85rem;
  font-size: 13.5px;
  line-height: 1.65;
  color: rgb(var(--color-ink-muted2));
}
.dp-prose > ul,
.dp-prose > ol {
  padding-left: 1.15rem;
}
.dp-prose > ul {
  list-style: disc;
}
.dp-prose > ol {
  list-style: decimal;
}
.dp-prose li + li {
  margin-top: 0.35rem;
}
/* Scoped to text containers rather than every descendant <a>: a card that is
   itself a link sets no-underline, and a bare `.dp-prose a` rule outranks
   that class and underlines the whole card. */
.dp-prose :where(p, li, td) a {
  color: rgb(var(--color-brand-text));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dp-prose :where(p, li, td) a:hover {
  color: rgb(var(--color-brand-hover));
}
.dp-prose code {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  background: rgb(var(--color-surface-subtle));
  border-radius: 5px;
  padding: 1px 5px;
  color: rgb(var(--color-ink-900));
}
/* Code blocks bring their own styling from DevportalCode; the inline rule
   above must not repaint their contents. */
.dp-prose pre code {
  background: none;
  padding: 0;
  color: inherit;
  font-size: inherit;
}
.dp-prose strong {
  font-weight: 600;
  color: rgb(var(--color-ink-800));
}
.dp-prose hr {
  margin: 2rem 0;
  border-color: rgb(var(--color-line-divider));
}
</style>
