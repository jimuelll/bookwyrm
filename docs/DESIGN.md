# Bookwyrm Design

**Status:** v1, derived from the shipped landing page (`frontend/src/features/landing`, `frontend/src/scene`).
**Related:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

This file records how Bookwyrm looks and why, so new screens (Library, Quiz, Results, Progress) feel like the same product. The tokens live in code at `frontend/src/styles/tokens.css`; this document explains them.

---

## 1. Philosophy

**A storybook library that is also a tool you use every day.**

- **The world is an old, lamplit library painted in watercolour.** Leather spines, gilt bands, scrolls, a rolling ladder, a brass lantern. It sets the mood in the hero and in a few key moments. It never sits behind working UI.
- **The tool is calm and bookish.** Working screens are paper pages with clear type, thin rules and one accent. They borrow book conventions (drop caps, running heads, folios, plates, Roman numerals for real sequences) rather than SaaS conventions (gradients, glass, pill chips, emoji).
- **Citations are the hero of the product, so they are visible everywhere.** Any question, answer or explanation shows its page. Treat "p. 42" like a link to proof, not a footnote.
- **One accent, used sparingly.** Lamplight amber at night, banker's-lamp green by day. It marks the primary action, the drop cap, and small labels. Nothing else competes with it.

Avoid: cream-and-terracotta templates, purple gradients, glassmorphism, rounded-everything cards, emoji as icons, eyebrow pills above headlines, italic-serif "startup" heroes.

## 2. Colour

Two themes designed together. Day is parchment and ink; night is dark vellum by lamplight. The theme is always resolved onto `<html data-theme="light|dark">` before first paint (see `index.html`), following the OS until the reader picks one; the pick is stored in `localStorage` under `bookwyrm-theme`.

| Token | Day | Night | Use |
|---|---|---|---|
| `--bg` | `#E6DAC2` | `#0D0907` | Page background outside pages/cards |
| `--page` | `#F2E9D5` | `#1B140E` | Book pages, cards, panels |
| `--bar` | `#F2E9D5` | `#140F0A` | Pinned app bar |
| `--ink` | `#241A11` | `#EEE2CA` | Primary text |
| `--muted` | `#4D3E2F` | `#BCAB8E` | Secondary text, nav links |
| `--rule` | `#C9B693` | `#43331F` | Hairlines, borders, dividers |
| `--frame` | `#8A6C45` | `#7C5D37` | Decorative frames (plate, drop cap) |
| `--accent` | `#2E5B44` | `#E3A64F` | Primary action, drop cap, small caps labels |
| `--accent-ink` | `#F2E9D5` | `#170F08` | Text on accent |
| `--correct` | `#33591F` | `#A9C77E` | Quiz state: right answer (always with an icon and a word) |
| `--incorrect` | `#8E2A2A` | `#EC9A88` | Quiz state: wrong pick (always with an icon and a word) |
| `--mark` | `rgb(46 91 68 / .17)` | `rgb(227 166 79 / .24)` | Highlight behind a cited sentence |
| `--surround` | `rgb(34 22 12 / .6)` | `rgb(6 4 3 / .62)` | Dim over the scene around the book |
| `--on-surround` | `#F2E9D5` | `#EEE2CA` | Text on the dimmed scene |
| `--page-shade` | `rgb(92 64 34 / .16)` | `rgb(0 0 0 / .35)` | Gutter and page-edge shading |

Rules:
- Text pairs meet WCAG AA, measured against the worst case (paper grain plus gutter shade): muted is at least 5:1 on page and bg in both themes; accent-ink on accent at least 6:1.
- Never use accent for large fills or backgrounds. One primary button per view.
- Quiz states use `--correct` / `--incorrect`, separate from the accent, and always carry an icon and a word.
- Paper grain: `--paper` is an SVG noise tile layered under page backgrounds (`background: var(--paper), var(--page)`). Use it on pages and large sections, not on small controls.

Tailwind exposes the same tokens as utilities (`bg-page`, `text-ink`, `border-rule`, `text-accent`, `font-display`, ...) through `@theme inline` in `src/index.css`, so components can use either.

## 3. Typography

All three faces are self-hosted via `@fontsource` (no runtime Google Fonts).

| Role | Face | Where |
|---|---|---|
| Display | **IM Fell English** (roman + italic) | Headlines, section titles, captions, italic text links, folios |
| Small caps | **IM Fell English SC** | Brand, running heads, numerals, step labels, control labels (Pause) |
| Body / UI | **EB Garamond** 400, 500, italic | Paragraphs, nav, buttons, list items |

Scale (desktop → phone, via `clamp`):
- Hero H1: 58 → 34px, line-height 1.1, `text-wrap: balance`.
- Section H2: 46 → 30px. H3: 26px.
- Lede: 20 → 17px, line-height 1.6. Body: 18px / 1.6. Small UI: 16–17px. Labels: 14–15px small caps with 0.06–0.1em tracking.
- Keep running text near 65 characters; never below 15px for reading text.

Book conventions we use (each must encode something true):
- **Drop cap** on the first letter of the first body paragraph under a page-level headline (`::first-letter`), in accent, inside a double rule. Never on the headline itself. One per screen.
- **Running head** in small caps at the top of a plate or page ("Plate the First").
- **Folios** (— i —, — ii —) at the foot of book pages on desktop only.
- **Roman numerals** only for real sequences (the three steps of how it works, chapters).
- **Italic display** for secondary links, captions and citations ("p. 142").

## 4. Layout

- **Pinned app bar** (`.bar`), always at the top: brand · nav · theme toggle · primary "Upload a PDF". 64px tall (56px under 900px). Links collapse in stages (Evaluation under 1100px, How it works under 900px); on phones the upload button becomes icon-only with an accessible name.
- **Content width:** 1320px max for the book spread, 1120px for content sections. Side gutter `max(16px, env(safe-area-inset-*))`.
- **The book spread** (landing hero): a two-column grid (left page 1fr, right page 1.08fr) with a shaded gutter. Left page holds the copy; right page is paper with a transparent window (the plate) cut by CSS mask, framed by a double rule. The scene shows through the plate and, dimmed by `--surround`, around the book.
- **Phones (≤ 900px):** the spread stacks: copy page first (headline, body, CTA), then the plate window with the sample-question tab on the paper below it; folios, running head and caption hide; the primary button goes full width; three-step lists stack.
- Spacing follows a 4/8px rhythm; section padding uses `clamp(48px, 8vw, 104px)`.
- **Product at a glance:** the hero plate carries a "Try a sample question" tab that opens a real, interactive question with its citation, so the painting stays clean until asked. The app bar hides its Upload button while the hero's is on screen.

## 5. Components (current)

| Component | Notes |
|---|---|
| Button, primary (`.btn-primary`) | Accent fill, 2px radius, 44px min height (52px `.btn-lg` in heroes), EB Garamond 500, upload icon leading. Hover brightens; press nudges 1px. |
| Text link (`.text-link`) | IM Fell italic with a rule-coloured underline that turns accent on hover. Used for secondary actions instead of a second button. |
| Icon button (`.icon-btn`) | 44px circle, rule border; always has `aria-label`. Theme toggle shows the icon of the mode you will switch to. |
| Sample question (`.sample`) | A loose page over the plate: question, four options, verdict, citation (`.cite`) that swaps the options for the source passage with the supporting sentence marked. Opened from `.sample-trigger`; Esc or × closes and returns focus. |
| Plate (`.page-r` + `.plate-frame`) | Framed window onto the scene, with running head, caption, and a Pause/Play control. |
| Section list (`.how`) | HTML/CSS paper artifact (`.art`), then Roman numeral, display H3, muted paragraph. |
| Login modal (`.auth`) | Native `<dialog>` opened with `showModal()`, framed like the sample card over a dimmed backdrop. Brand + ×, display H2 ("Log in" / "Create your account"), a muted line saying why it opened, **Continue with Google** as an outline button (`.btn-outline`, Google's own coloured "G" per their branding rules), an italic "or" rule, then email + password with small-caps labels and one primary submit. A `.text-link` switches between log in and sign up. Errors are one line in `--incorrect` (`role="alert"`). Opened by the bar's Log in and by any gated action (Upload a PDF); Esc, × or the backdrop closes it and focus returns to the opener. |

Icons: one line set (`src/components/icons.tsx`), 1.6px stroke, round caps, 18px in controls. Decorative icons are `aria-hidden`; the control carries the name.

Radii: 2–3px only (paper corners). Shadows: only the book's drop shadow and the plate's inner shadow. No card shadows on working screens; separate with rules and paper tone instead.

## 6. The painted scene ("The Stacks")

Code: `frontend/src/scene/stacksScene.ts` (three.js) and `watercolorShader.ts`.

- **Content:** a front-on wall of 12 bays × 9 shelves with ~1,000 instanced leather books (oxblood, bottle green, navy, tan, vellum), gilt spine bands, rolled scrolls, flat stacks, a rolling ladder, a hanging brass lantern, floating motes, and the wyrm on the fifth shelf. Generated from a fixed seed so it is identical on every load.
- **Night:** the lantern is the key light (point + shadowed spot, gentle flicker and sway), cool violet ambient, warm bloom around the lamp, edges falling into umber.
- **Day:** a sun from the upper left with soft shadows, a light shaft through the stacks, edges fading into paper.
- **Watercolour pass:** simplified Kuwahara (flat washes), pigment pooling at edges, tonal banding, granulation, wet-in-wet blooms and paper fibre. Do not add outlines, glyph/ASCII effects or dithering; the look is painted, not technical.
- **Framing:** the canvas covers the hero; the camera offsets its view and fits its lens to the plate, so any screen size shows roughly three shelves.
- **Lighting units:** three r155+ uses physical light units. Legacy-tuned values are scaled by `AMBIENT_SCALE` (π) and `PUNCTUAL_SCALE` (23) at the top of `stacksScene.ts`; tune there, not per light.
- **Performance and access:** three.js is loaded lazily after the text paints; the rAF loop fully stops offscreen, in hidden tabs and while paused (it restarts on demand); devicePixelRatio is capped at 2; the render target is 0.75× device pixels; `prefers-reduced-motion` starts it paused; the reader can always Pause/Play. If WebGL fails, a painted-stripe fallback shows. Planned: a looping video of each mode as the no-WebGL fallback.

## 7. Mascot: the Paper Wyrm

A small dragon-worm made of the books it reads. It is the brand's character, used in the hero, loaders, empty states and errors.

- **Body:** a chain of vellum page-blocks in two parchment tones (`#D6C298`, `#BFA678`) separated by gilt bands (`#C99A48`), with small page-corner fins along the back. Tapers toward the tail.
- **Head:** a rolled page with its spiral end visible, a gilt collar band, a page-shaped snout with a gold jaw line, and two scroll-curl horns tipped in gold.
- **Eye:** the one glowing point in the scene, amber (`#FFA235`), with a slit pupil. It blinks.
- **Tail:** a red silk bookmark ribbon (`#8E2A2A`) that flutters.
- **Behaviour:** burrows through the spines, weaving in front of and behind the books and leaving dark holes; every few seconds it turns to glance at the reader. Calm, curious, never frantic.
- **Use:** loaders show it burrowing across a progress line ("Reading p. 41 of 148"); empty states show it curled on a book; errors show it peering out of a hole. Keep it small in working screens; it is a companion, not decoration on every card.
- **Open item:** a close-up character sheet to refine the face before using it at large sizes.

## 8. Motion

- Ambient motion lives in the scene only (camera drift, lantern sway, wyrm, motes). UI motion is limited to hover/press feedback (150–200ms) and the scroll-hint nudge.
- Everything honours `prefers-reduced-motion`; animated content has a visible pause control.

## 9. Accessibility checklist

- Contrast: AA for all text in both themes; never put text directly on the scene except on the dimmed surround.
- Targets: 44px minimum for every control.
- Focus: 2px accent outline with 3px offset on every interactive element.
- The scene is decorative (`aria-hidden`); all meaning is in text.
- Headings are sequential (one H1 per page).
- Theme and motion preferences are respected on first load.

## 10. Copy voice

Plain, specific and calm. Say what happens ("Upload a PDF", "Each answer cites its page"). The fantasy lives in the visuals and a few captions ("The stacks by lamplight, where the wyrm reads ahead of you"), never in buttons, errors or instructions. Examples in the UI are marked as samples.
