# Material ripple state layer and theme reveal pulse

Desktop Material mirrors the `Desktop Material v2.dc.html` prototype's two
app-wide motion primitives:

- a **ripple state layer** that spawns at the press point inside every
  interactive control, scales, and fades; and
- a **theme reveal pulse** — a full-screen radial wash that radiates from the
  app-bar theme toggle corner on every theme change.

Both consume the global `dmRipple` / `dmReveal` `@keyframes` declared in
`app/styles/material/_motion.scss` (pre-staged for this feature) and are
suppressed under reduced motion.

## Behavior

### Ripple

- `attachRipple(host, origin)` in `app/src/ui/lib/ripple.ts` appends a single
  `<span class="md-ripple">` to the host, sized to `max(width, height)` and
  centred on the pointer (`origin.clientX/Y`, falling back to the host centre).
- The shared `Button` component (`app/src/ui/lib/button.tsx`) calls it from
  `onMouseDown`, so **every `Button` in the app ripples for free** — including
  preferences, dialogs, and toolbars — with no per-call-site wiring.
- The span inherits `currentColor`, so the state layer automatically tints to
  each control's `--md-sys-color-on-*` role (on-primary for filled/primary
  submit buttons, on-surface for tonal secondary buttons, on-error-container for
  destructive buttons).
- The span is removed on `animationend`, with a 700ms timeout fallback so it can
  never leak if the event is missed.

### Theme reveal

- `AppTheme` (`app/src/ui/app-theme.tsx`) mounts a transient
  `<div class="theme-reveal-overlay">` whenever the applied theme class actually
  flips, and removes it on `animationend` (1000ms fallback).
- The very first theme application (on mount) does **not** pulse; only
  subsequent flips do.
- The overlay is a fixed full-screen radial gradient with
  `transform-origin: 78% 8%` so the wash emanates from the app-bar toggle
  corner, matching the prototype.

## Styling

`app/styles/ui/_ripple.scss` styles the two transient elements and gives
`.button-component` a positioning context. Clipping to the pill silhouette is
free: `.button-component` already sets `overflow: hidden` via the `ellipsis`
mixin, and `overflow: hidden` respects the button's `border-radius`, so the
scaling circle never escapes rounded corners. The partial is registered in
`app/styles/_ui.scss`.

## Reduced motion

`prefersReducedMotion()` returns true when **either** the OS
`prefers-reduced-motion: reduce` media query matches **or** the app's own
`data-dm-motion="reduced"` appearance preference is set on `<body>`. In that
case:

- no ripple span is created; and
- no reveal overlay is mounted.

Because `AppTheme.applyAppearance()` writes `data-dm-motion` before the reveal
is evaluated, switching the app to reduced motion suppresses the pulse on the
same interaction. As a defense in depth, `_ripple.scss` and the global rules in
`_material-shell.scss` also force any such animation to an instant fade.

## Failure modes

- **Missing / disabled host** — `attachRipple` returns `null` for a null host or
  a natively disabled `<button>`; `Button` additionally skips the ripple when
  its `disabled` prop is set (it models disabled via `aria-disabled`).
- **No layout box** — with a zero-size host (e.g. detached element) the span is
  still created and cleaned up harmlessly.
- **Missed `animationend`** — the timeout fallbacks guarantee removal.

## Scope boundary

Controls that do not render through the shared `Button` — notably the toolbar
`ToolbarButton`/`ToolbarDropdown` family used by the top-level menu bar — do not
yet ripple. Wiring `attachRipple` into those toolbar controls is a follow-up
owned by the toolbar surface.

## Verification

`app/test/unit/ripple-motion-test.tsx` covers:

- ripple span lifecycle (created at the press point on `mousedown`, removed
  after `animationend`);
- pointer-centred and centre-fallback placement maths;
- suppression for a disabled button, the `data-dm-motion="reduced"` preference,
  and the system `prefers-reduced-motion` query;
- reveal overlay mount on theme flip (but not on mount), removal on
  `animationend`, suppression under reduced motion, and cleanup on unmount.
