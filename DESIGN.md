---
name: QuiroFlow
description: Clinic management in one app; a quiet, precise ledger for the whole practice.
colors:
  brand: "#4F46E5"
  brand-hover: "#4339CE"
  brand-text: "#3B32C9"
  brand-tint: "#EEF0FE"
  brand-tintBorder: "#D8DCFB"
  on-fill: "#FFFFFF"
  surface-page: "#F7F8FA"
  surface-sidebar: "#FBFBFC"
  surface-sidebarHover: "#F0F0F3"
  surface: "#FFFFFF"
  surface-subtle: "#FAFAFB"
  line: "#E8E9ED"
  line-control: "#E1E3EA"
  line-controlHover: "#CFD2DC"
  line-divider: "#F0F1F4"
  ink-900: "#15171E"
  ink-700: "#22252F"
  ink-600: "#2B3040"
  ink-500: "#3A3F52"
  ink-muted: "#686D7D"
  ink-muted2: "#6A6E7F"
  ink-faint: "#6C7081"
  ink-faint2: "#6E7282"
  ink-faint3: "#B6BAC6"
  success-text: "#157F52"
  success-accent: "#1A8457"
  success-bg: "#E9F6EF"
  warning-text: "#96591A"
  warning-accent: "#B45309"
  warning-bg: "#FEF6E7"
  info-text: "#7E22CE"
  info-accent: "#9333EA"
  info-bg: "#F7F0FD"
  danger-text: "#B4233C"
  danger-bg: "#FDF0F2"
  danger-border: "#F4DADE"
  chip-bg: "#F1F2F5"
  chip-border: "#E4E5EB"
  chip-text: "#686D7D"
  scrim: "#15171E"
typography:
  display:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 640
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 640
    letterSpacing: "0.07em"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "23px"
    fontWeight: 600
rounded:
  ctlSm: "7px"
  ctl: "8px"
  card: "11px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-fill}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-500}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    textColor: "{colors.ink-muted2}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-subtle}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.ctl}"
    padding: "0 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
  pill-neutral:
    backgroundColor: "{colors.chip-bg}"
    textColor: "{colors.chip-text}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  pill-brand:
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand-text}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  pill-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  nav-item:
    textColor: "{colors.ink-600}"
    rounded: "{rounded.ctlSm}"
    padding: "0 9px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.brand-tint}"
    textColor: "{colors.brand-text}"
    rounded: "{rounded.ctlSm}"
    padding: "0 9px"
    height: "32px"
---

# Design System: QuiroFlow

## Overview

**Creative North Star: "The Clinic Ledger"**

QuiroFlow looks like a well-kept record of a clinic's clinical and financial life. Pages are near-white sheets ruled with hairlines. Type is small, even and dense, so a full day of appointments, a patient's history or a month of invoices fits on one screen without scrolling. Numbers are set like entries in a ledger: monospaced figures for money, counts and times, so columns line up and amounts can be compared at a glance.

The system is quiet on purpose. One colour, QuiroFlow Indigo, marks what to do next and where you are. Everything else is graphite ink on paper-white, with soft tinted fills for status. Brand shows in precise details (a 640-weight title, a tight -0.012em tracking, a 6px status dot), never in decoration. Depth is almost absent: surfaces are separated by 1px lines and a whisper of shadow, and only things that genuinely float (menus, dialogs, drawers) cast a real one.

Three looks are ruled out. Generic SaaS gloss (gradients, glass, hero illustrations, coloured glows) does not appear inside the app. Neither does old medical software (grey Windows-era forms, tables with no hierarchy), which is what clinics are leaving. Nor anything playful or consumer: big rounded bubbles, emoji, rainbow palettes or bouncy motion.

**Key Characteristics:**
- Paper-white surfaces on a cool off-white page, ruled with 1px hairlines.
- A single indigo accent for action, selection and the current place.
- Small, dense Instrument Sans (13px body) with tight-tracked semibold titles.
- Monospaced JetBrains Mono for figures: money, counts, times, invoice numbers.
- Status as soft tinted fills with strong text, never as saturated blocks.
- Controls sized for both a mouse (36px) and a finger on the front-desk iPad (44px).
- Every grey that carries words meets WCAG AA (4.5:1); nothing smaller than 11px.
- A full dark theme with the same roles, switched with one attribute.

## Colors

A cool graphite-and-paper neutral scale carrying one confident indigo, with four muted status families.

Every colour is a CSS variable defined in `assets/css/theme.css` as an RGB triplet (light in `:root`, dark in `[data-theme='dark']`) and reached through Tailwind as `brand`, `surface-*`, `line-*`, `ink-*` and the status families. The hex values above are the light theme. The dark theme keeps every role and its contrast relationship rather than inverting: the page becomes a near-black `#0F1014`, ink becomes near-white, and indigo lifts to `#818CF8`.

### Primary
- **QuiroFlow Indigo** (`brand`): primary buttons, the selected tab or segment, the inbox unread badge, the logo tile, focus borders. It marks the one thing to do or the place you are.
- **QuiroFlow Indigo, pressed** (`brand-hover`): hover and pressed state of indigo fills.
- **Indigo Ink** (`brand-text`): indigo used as text, such as links, the active nav label and brand pills, a shade deeper so it reads on white and on its own tint.
- **Indigo Wash** (`brand-tint`, `brand-tintBorder`): the active nav item's background, brand pills, the icon tile in empty states, selected rows.
- **On Fill** (`on-fill`, used as `text-brand-on`, `text-success-on`, `text-warning-on`, `text-danger-on`): text and icons drawn on a solid colour fill. White in light mode, near-black in dark mode, where the fills are pale.

### Neutral
- **Cool Page** (`surface-page`): the page behind every card.
- **Sidebar Paper** (`surface-sidebar`, `surface-sidebarHover`): the navigation column, one step off white, with its own hover step because the generic subtle fill vanishes against it.
- **Paper White** (`surface`): cards, inputs, dialogs, the page header bar.
- **Paper Shade** (`surface-subtle`): hover fill on ghost buttons and rows, and the "coming soon" panel.
- **Hairline** (`line`, `line-divider`): card borders, the page header rule, section dividers. `line-row`/`line-row2`/`line-faint` in the CSS are fainter steps for table rows.
- **Control Edge** (`line-control`, `line-controlHover`): the border of inputs, selects and secondary buttons, darkening on hover.
- **Graphite Ink** (`ink-900` to `ink-500`): text. `ink-900` for titles and values, `ink-700`/`ink-600` for body and nav, `ink-500` for secondary-button labels.
- **Muted Ink** (`ink-muted`, `ink-muted2`): descriptions, meta lines, timestamps and ghost buttons.
- **Faint Ink** (`ink-faint`, `ink-faint2`): group labels, hints, placeholders. All four muted and faint greys are text colours and reach WCAG AA (4.5:1) on the page, so the steps between them are deliberately small; hierarchy comes from size and weight first.
- **Dot Grey** (`ink-faint3`): dots and separators only. It is decoration and never carries words.
- **Chip Grey** (`chip-bg`, `chip-border`, `chip-text`): neutral pills, counts, skeleton base.

### Status
Each family has a strong text colour, an accent for dots and icons, a soft background and a border.
- **Ledger Green** (`success-*`): paid, confirmed, active, accepted by the AEAT.
- **Amber Note** (`warning-*`): pending, due soon, needs attention.
- **Violet Note** (`info-*`): informational and neutral-positive states. Info is violet here, not blue, so it never competes with the indigo accent.
- **Correction Red** (`danger-*`): errors, debts, cancellations, destructive actions.

Charts add `chart-cancelled` (`#F6C7CE`) and `chart-projected` (`#C7CBFA`), and switches use `toggle-off` (`#D8DAE2`). Modals, drawers and the command palette dim the page with **Scrim** (`scrim`, always with opacity such as `bg-scrim/40`), which darkens in both themes.

### Named Rules
**The One Ink Rule.** Indigo is the only accent. It marks action, selection and location, and nothing decorative. A screen where indigo is everywhere has no next step.

**The Tint, Not Block Rule.** Status is a soft tinted fill carrying strong text in the same hue (`success-bg` + `success-text`). Saturated status blocks only appear as 6px dots or chart marks.

**The Variable-Only Rule.** Colours are always the theme variables, never literal hex in a component. A hard-coded colour breaks dark mode on that one spot.

**The On-Fill Rule.** Text on a solid fill uses the `-on` colour, never `text-white`. In dark mode the brand fill is pale indigo and white text on it drops to 3:1.

## Typography

**Display Font:** Instrument Sans (with ui-sans-serif, system-ui)
**Body Font:** Instrument Sans
**Label/Mono Font:** JetBrains Mono, for figures

**Character:** A crisp, slightly condensed grotesque used small and even, with weight doing the work that size does elsewhere. JetBrains Mono sets the numbers the way a ledger column would. Both are self-hosted from `public/fonts/` (Instrument Sans is one variable file, 400 to 700). Until it loads, text is set in a metric-matched Arial or Roboto fallback (`Instrument Sans Fallback`) with `font-display: optional`, so the page never reflows when the font arrives.

### Hierarchy
- **Display** (600, 30px, 25px below `lg`, line-height 1.18, -0.012em): sign-in, sign-up and onboarding headings only. The app itself has no display text.
- **Headline** (640, 18px, -0.012em): the page title in the page header bar, and dialog titles.
- **Title** (600, 16px, -0.012em): section and card titles, empty-state titles. Card headers in dense screens drop to 14 to 14.5px.
- **Body** (400 to 500, 13px, about 1.5): the workhorse: table cells, form text, nav items (13.5px), buttons (13px).
- **Body small** (400, 12.5px, 1.55): descriptions, meta beside the page title, helper text. Keep descriptions under about 46ch.
- **Label** (640, 11px, 0.07em, uppercase): sidebar group headings and section eyebrows. Pills use 11px semibold, not uppercase.
- **Figure** (JetBrains Mono 600, 23px): KPI values on dashboards and reports. Smaller mono (11px) for counts in the nav and times in lists.

### Named Rules
**The Small Type Rule.** Body is 13px and the scale stays between 11px and 18px inside the app. 11px is the floor: nothing smaller. Hierarchy comes from weight (400, 500, 600, 640) and ink colour before it comes from size.

**The Ledger Figures Rule.** Money, counts, times and document numbers use JetBrains Mono so they align in columns. Prose about the number stays in Instrument Sans.

## Layout

The staff app is a fixed left sidebar beside a scrolling content column. The sidebar is 236px (60px collapsed, 68px on touch) from `lg` (1024px) up; below that it becomes a 260px drawer over a 40% scrim. Each page opens with a 56px white header bar (`PageHeader`) ruled off by a hairline: title and meta on the left, actions on the right, wrapping onto two lines on a phone.

Content sits in white cards on the cool page with 16px padding (24px for settings forms and roomy panels), gaps of 8 to 16px, and the 4px Tailwind spacing scale throughout. Density is high: controls are 36px, compact chips and segments 32px, rows tight.

The `touch:` variant (`@media (pointer: coarse)`, in `tailwind.tokens.ts`) grows every control to 44px on a touch screen while a mouse keeps the dense 36px. The `short:` variant (`@media (max-height: 600px)`) folds away secondary chrome, such as the Inbox filters, on a zoomed laptop or a phone on its side. Breakpoints are Tailwind's defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Dialogs dock to the bottom of the screen on phones and centre from `sm`. The mobile app in `mobile/` compiles the same tokens and components.

### Named Rules
**The Two-Pointer Rule.** Every interactive control declares both sizes: `h-9 touch:h-11` (or `h-8 touch:h-11` for compact ones). A control sized only for a mouse is too small on the front-desk iPad.

## Elevation & Depth

Flat by default, ruled rather than lifted. Cards are separated from the page by a 1px hairline and, at most, a near-invisible card shadow. Real shadows are reserved for things that float above the page.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgba(20,22,30,.04)`): resting cards and empty-state panels; barely there.
- **Popover** (`box-shadow: 0 12px 32px rgba(20,22,30,.14)`): menus, dropdowns, the command palette, dialogs.
- **Drawer** (`box-shadow: -16px 0 40px rgba(20,22,30,.12)`): side panels sliding in from the right.
- **Focus** (`box-shadow: 0 0 0 3px rgb(var(--color-brand) / 0.14)`): the soft indigo ring around a focused field or tile, following the theme. `focusDanger` is the same in red for invalid fields.
- **Selected** (`box-shadow: 0 0 0 3px #EEF0FE`): a selected tile's halo. It is a literal light value, so it does not follow dark mode.

### Named Rules
**The Float-Only Shadow Rule.** If it does not float above the page, it gets a hairline, not a shadow. Coloured or glowing shadows are never used.

## Shapes

Gently rounded, never bubbly. Controls (buttons, inputs, selects) have 8px corners (`ctl`), small controls such as icon buttons and nav items 7px (`ctlSm`), and cards, dialogs and empty-state tiles 11px (`card`). Pills and badges are fully rounded (`pill`, 20px), and status dots are circles of 5 to 6px. Borders are always 1px.

Icons are stroked line icons (Heroicons outline style), 15 to 16px, stroke 1.3 to 1.6, inheriting the text colour.

## Components

### Buttons
Restrained and exact: a solid indigo for the one main action, outlined paper for everything else.
- **Shape:** gently rounded (8px), 36px tall at 14px side padding, 13px medium text (`UiBtn`, size `md`). `sm` is 32px at 12.5px; `lg` is 44px at 14px for thumb targets in the app.
- **Primary:** indigo fill and border, semibold `brand-on` text, darkening to `brand-hover`.
- **Secondary (default):** white fill, `line-control` border, `ink-500` text; the border darkens to `line-controlHover` on hover.
- **Ghost:** no border, `ink-muted2` text, `surface-subtle` fill on hover.
- **Disabled:** 50% opacity and a not-allowed cursor.
- **Icon button** (`UiIconBtn`): 28px square (40px on touch), faint icon, subtle fill on hover; the `danger` tone turns the hover red. Its label is required and becomes the aria-label and tooltip.
- **Confirm dialogs** commit with a near-black `ink-900` button, or `danger-text` red when the action destroys something.

### Chips
- **Style** (`UiPill`): 11px semibold text on a soft tinted fill, fully rounded, 2px by 8px, in six tones: neutral, brand, success, warning, info, danger.
- **Dot:** an optional 6px dot in the tone's accent colour before the label.
- **Counts:** nav counts are neutral pills; unread inbox counts are indigo pills with white text.

### Cards / Containers
- **Corner Style:** 11px.
- **Background:** Paper White on the Cool Page.
- **Shadow Strategy:** hairline border, optionally the Card shadow (see Elevation & Depth).
- **Border:** 1px `line`.
- **Internal Padding:** 16px, or 24px for settings sections. Table cards drop the padding and clip their rows (`overflow-hidden`).

### Inputs / Fields
- **Style:** white fill, 1px `line-control` border, 8px corners, 36px tall (44px on touch), 12px side padding, 14px `ink-900` text, `ink-faint2` placeholder. Native selects draw one shared chevron inset 12px from the right edge.
- **Focus:** the border turns indigo with a 1px indigo ring (or the soft 3px Focus shadow in onboarding).
- **Error / Disabled:** red border with the `focusDanger` ring; disabled controls fade and lose the pointer.

### Navigation
- **Sidebar:** Sidebar Paper column with a hairline on its right. The brand row has a 24px indigo tile with the white mark and "QuiroFlow" in 14.5px 640. Below it is a clinic switcher (white control with a tinted initials square).
- **Groups:** 11px uppercase 640 labels in `ink-faint`, collapsible, with their chevron showing on hover.
- **Items:** 32px tall (44px on touch), 13.5px `ink-600` with a 15px line icon, `surface-sidebarHover` on hover. The active item is Indigo Wash with Indigo Ink semibold text and `aria-current="page"`.
- **Mobile:** below `lg` the sidebar is a drawer over a scrim. Collapsed, items become 36px icon squares with the label as tooltip.

### Empty State
The signature "nothing here yet" panel (`UiEmptyState`), so an empty screen never reads as one that failed to load: a white card (max 540px) holding a 48px Indigo Wash icon tile, an optional 11px uppercase eyebrow pill, a 16px title, a 12.5px muted sentence that says what will fill this, and the action. The `soon` tone swaps to Paper Shade and grey so "not built yet" never looks like "nothing yet".

### Skeleton
Loading placeholders (`UiSkeleton`) are chip-grey blocks with a slow 1.6s highlight sweep. Under `prefers-reduced-motion` every animation and transition in the app lands in its end state at once; only spinners keep turning, because they are the one sign something is still loading.

## Do's and Don'ts

### Do:
- **Do** use the theme variables through Tailwind (`bg-surface`, `text-ink-700`, `border-line`) so every screen works in both themes.
- **Do** keep indigo for the one primary action, the current place and selection (The One Ink Rule).
- **Do** size every control for both pointers: `h-9 touch:h-11`, or `h-8 touch:h-11` when compact.
- **Do** set money, counts, times and document numbers in JetBrains Mono.
- **Do** put `text-brand-on` (or the matching `-on`) on solid fills, and `bg-scrim/40` behind modals.
- **Do** show status as a `UiPill` (tinted fill, strong text, optional 6px dot).
- **Do** use the shared primitives (`UiBtn`, `UiIconBtn`, `UiPill`, `UiEmptyState`, `PageHeader`, `UiConfirmDialog`) before writing a new one.
- **Do** separate surfaces with 1px hairlines and keep shadows for menus, dialogs and drawers.

### Don't:
- **Don't** add gradients, glassmorphism, hero illustrations or coloured glows inside the app. That is generic SaaS gloss.
- **Don't** fall back to grey form panels, bevelled chrome or tables with no hierarchy. That is the old medical software clinics are leaving.
- **Don't** go playful: no bubbly oversized radii, emoji in the interface, rainbow palettes or bouncy motion.
- **Don't** introduce a second accent colour, or use indigo as decoration.
- **Don't** write a literal hex or rgba colour in a component; it will not follow dark mode.
- **Don't** set app text above 18px except figures and the sign-in and onboarding headings, or below 11px anywhere.
- **Don't** use `ink-faint3` for words; it is for dots and separators.
- **Don't** leave an empty screen as a bare centred paragraph; use `UiEmptyState`.
