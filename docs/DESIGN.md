# Bookwyrm Design

**Status:** v1, derived from the shipped pages (`frontend/src/app`, `frontend/src/features`, `frontend/src/scene`).
**Related:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

This file records how Bookwyrm looks and why, so new screens (Library, Quiz, Results, Progress) feel like the same product. The tokens live in code at `frontend/src/styles/tokens.css`; this document explains them.

---

## 1. Philosophy

**A storybook library that is also a tool you use every day.**

- **The world is an old, lamplit library painted in watercolour.** Leather spines, gilt bands, scrolls, a rolling ladder, a brass lantern. It sets the mood in the hero and in a few key moments. It never sits behind working UI. Inside the app (the Library) the same world appears as **copperplate engraving** instead of paint: the book's interior illustrations (section 6a).
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
| `--ribbon` | `#8E2A2A` | `#A8383A` | The wyrm's red silk bookmark: current page in the bar (decorative only) |

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

- **Pinned app bar** (`.bar`, `src/app/shell.css`), on every page, reading like a book's running head. 64px tall (56px under 900px), paper-grain background, a 3px double rule underneath.
  - **Logged out:** brand · Home · About · Log in (outline button) · theme toggle.
  - **Logged in:** brand (goes to the Library) · Library · About · Upload a PDF (the one primary button, always visible) · account (the reader's initial; a small paper card with their email, a Settings link and Log out) · theme toggle. The landing page redirects logged-in readers to the Library, so the hero's button and the bar's never compete.
  - Nav labels are IM Fell SC with hairline dividers between them. The **current page** is marked by ink colour plus a short red bookmark ribbon (`--ribbon`, swallowtail cut) tucked in from the bar's top edge above the label; it never hangs outside the bar.
  - Under 900px the Upload button becomes icon-only with an accessible name; under 480px the wordmark is visually hidden (the wyrm mark stays, the link keeps its name).
- **Pages:** `/` landing (visitors only), `/about`, `/library` and `/settings` (login required; logged out they show "Log in to see your …"). Settings uses the Library's title treatment (display H1 over a double rule), then sections laid out as a small-caps label column beside the form, separated by rules; form fields reuse the login modal's field styles. Inner pages use `.sheet`: content width on the page background, no card around the whole page.
- **Library (logged-in home):** "Shelf + panel", readability first: at first glance you know what to do, and a new reader's page fits one screen with one action. It is set in the hero's world without copying it: the content sits on a **paper sheet** (max 1140px, paper grain, deep shadow) laid over a **surround** darker than the page with a lamp glowing from the upper right, as the hero's book lies over its dimmed scene. On the sheet: the **heading** ("Ex Libris" in accent small caps above "<name>'s library" in display type; together the H1) with one muted line of where things stand, over a double rule. Then a grid: **Your books** (main column) beside a 360px **side panel**. For a new reader, Your books is one dashed area: three ghost book covers in the hero's leathers (oxblood, bottle green, navy), "Your first book goes here", one line, and **Upload your first PDF** (primary). The side panel holds **Plate I** (section 6a) framed like the hero's plate (double rule, inner shadow) with a caption ("Plate I" in small caps; "The wyrm at the inkwell, by lamplight/daylight." in italic), then **How it works** in three numbered steps. Under 860px the panel drops below the shelf and the plate keeps its 6:5 shape (capped at 440px), never re-cropped. **Once the reader has PDFs**, the lede says how many ("3 PDFs on your shelf.") and Your books is **one row per PDF**, newest first, between hairline rules (`design/library-task.html`, option C): a small cover in one of the hero's leathers (fixed per book, picked from its id), the title as an H3, "148 pages · added today", and on the right a small-caps **Ready** with a check. While a PDF is being read, the row shows a thin three-step rule and the step in small caps ("Waiting to be read…", "Reading the pages…", "Splitting into passages…"), and the page polls until it's done. A PDF that couldn't be read shows the reason in `--incorrect`, a greyed cover and an italic **Remove**. The last row is **Add a PDF** (dashed ghost cover, italic title, upload icon), not a second primary button. If the shelf can't be loaded, it says so with **Try again** and never claims the library is empty. Planned once quizzes exist: a **Continue where you left off** bar above Your books (cover, title, "question 7 of 12", confidence as words plus a bar, Resume quiz / Open PDF), quizzes and confidence on each row, and stats in the panel instead of the steps.
- **Content width:** 1320px max for the book spread, 1120px for content sections. Side gutter `max(16px, env(safe-area-inset-*))`.
- **The book spread** (landing hero): a two-column grid (left page 1fr, right page 1.08fr) with a shaded gutter. Left page holds the copy; right page is paper with a transparent window (the plate) cut by CSS mask, framed by a double rule. The scene shows through the plate and, dimmed by `--surround`, around the book.
- **Phones (≤ 900px):** the spread stacks: copy page first (headline, body, CTA), then the plate window with the sample-question tab on the paper below it; folios, running head and caption hide; the primary button goes full width; three-step lists stack.
- Spacing follows a 4/8px rhythm; section padding uses `clamp(48px, 8vw, 104px)`.
- **Product at a glance:** the hero plate carries a "Try a sample question" tab that opens a real, interactive question with its citation, so the painting stays clean until asked. Logged out, the hero's button is **Get started** (opens the login modal on sign-up, then continues to the Library); logged in it is **Upload a PDF**, and the bar hides its own Upload while the hero's is on screen.

## 5. Components (current)

| Component | Notes |
|---|---|
| Button, primary (`.btn-primary`) | Accent fill, 2px radius, 44px min height (52px `.btn-lg` in heroes), EB Garamond 500, upload icon leading. Hover brightens; press nudges 1px. |
| Text link (`.text-link`) | IM Fell italic with a rule-coloured underline that turns accent on hover. Used for secondary actions instead of a second button. |
| Button, outline (`.btn-outline`) | Transparent with a rule border that turns accent on hover. The secondary action beside a primary (Log in in the bar, Continue with Google). |
| Icon button (`.icon-btn`) | 44px circle, rule border; always has `aria-label`. Theme toggle shows the icon of the mode you will switch to. |
| Sample question (`.sample`) | A loose page over the plate: question, four options, verdict, citation (`.cite`) that swaps the options for the source passage with the supporting sentence marked. Opened from `.sample-trigger`; Esc or × closes and returns focus. |
| Plate (`.page-r` + `.plate-frame`) | Framed window onto the scene, with running head, caption, and a Pause/Play control. |
| Section list (`.how`) | HTML/CSS paper artifact (`.art`), then Roman numeral, display H3, muted paragraph. |
| Feature row (`.feature`, About) | Display H2 and muted paragraphs on one side, a paper artifact (`.art`) on the other, sides alternating per row, rows separated by rules. Artifacts are labelled "Sample" and `aria-hidden`; the text carries the meaning. |
| Library heading (`.library-head`) | "Ex Libris" in wide-tracked accent small caps above "<name>'s library" in display type, both inside the H1 (a real space between). Before the name loads, a blank ruled line, never a guess. A muted line beside it, then a double rule. |
| Empty shelf (`.shelf-empty`) | Dashed frame-coloured area filling the main column: ghost covers (`.cover`, engraved cloth with a spine band and paper label, tinted with the hero's leathers), a display title, one muted line and the primary Upload button. |
| Book row (`.shelf-book`) | One PDF on the shelf (namespaced: the landing hero already owns `.book`, and CSS is global once a page has loaded it): `.cover` in its leather, display-type title (H3), muted meta line, and its state at the right (Ready / the reading step over a 4px `<progress>` rule / the failure reason and Remove). Rows are separated by rules, no cards. |
| Upload dialog (`.auth.upload`) | Opened by every Upload button (logged out, after the login modal). The login modal's frame and head; display H2 "Upload a PDF", one muted line, then a dashed drop area ("Drop a PDF here", italic "or" rule, **Choose a PDF** primary) that turns accent while a file is dragged over it. A muted hint gives the limits (selectable text, 25 MB, 500 pages). While sending: the file name, a 4px accent rule filling up, "Uploading… 40%" in small caps (then "Checking the PDF…" with a sweeping rule while the server checks it) and an italic **Cancel**. Errors are one `--incorrect` line (`role="alert"`). On success it closes and the Library shows the new row; a re-upload of the same file marks that row "Already on your shelf". Closing mid-upload cancels it. |
| Plate (`.plate`) | A picture framed as in the hero: 1px frame border plus an outline 5px out, an inner shadow, and a caption row (small-caps plate number left, italic caption right, naming day or night). Decorative: `aria-hidden` with its caption. |
| Login modal (`.auth`) | Native `<dialog>` opened with `showModal()`, framed like the sample card over a dimmed backdrop. Brand + ×, display H2 ("Log in" / "Create your account"), a muted line saying why it opened, **Continue with Google** as an outline button (`.btn-outline`, Google's own coloured "G" per their branding rules), an italic "or" rule, then email + password with small-caps labels and one primary submit. A `.text-link` switches between log in and sign up; "Forgot password?" sits beside the Password label and swaps the form for an email-only reset form. After sign-up or a reset request the modal becomes **Check your email** (address in ink, "Resend the email" and "Back to log in" links). Errors are one line in `--incorrect` (`role="alert"`); an unconfirmed-email error carries an inline "Resend the link". The emailed links land on plain `.sheet.gate` pages (`/auth/callback`: "Logging you in…"; `/auth/reset`: set a new password, typed twice). Opened by the bar's Log in (log-in form) and by any gated action (Get started opens on sign-up); Esc, × or the backdrop closes it and focus returns to the opener. |

Icons: one line set (`src/components/icons.tsx`), 1.6px stroke, round caps, 18px in controls. Decorative icons are `aria-hidden`; the control carries the name.

Radii: 2–3px only (paper corners). Shadows: only the book's drop shadow, the plate's inner shadow and the Library's desk band. No card shadows on working screens; separate with rules and paper tone instead.

## 6. The painted scene ("The Stacks")

Code: `frontend/src/scene/stacksScene.ts` (three.js) and `watercolorShader.ts`.

- **Content:** a front-on wall of 12 bays × 9 shelves with ~1,000 instanced leather books (oxblood, bottle green, navy, tan, vellum), gilt spine bands, rolled scrolls, flat stacks, a rolling ladder, a hanging brass lantern, floating motes, and the wyrm on the fifth shelf. Generated from a fixed seed so it is identical on every load.
- **Night:** the lantern is the key light (point + shadowed spot, gentle flicker and sway), cool violet ambient, warm bloom around the lamp, edges falling into umber.
- **Day:** a sun from the upper left with soft shadows, a light shaft through the stacks, edges fading into paper.
- **Watercolour pass:** simplified Kuwahara (flat washes), pigment pooling at edges, tonal banding, granulation, wet-in-wet blooms and paper fibre. Do not add outlines, glyph/ASCII effects or dithering; the look is painted, not technical.
- **Framing:** the canvas covers the hero; the camera offsets its view and fits its lens to the plate, so any screen size shows roughly three shelves.
- **Lighting units:** three r155+ uses physical light units. Legacy-tuned values are scaled by `AMBIENT_SCALE` (π) and `PUNCTUAL_SCALE` (23) at the top of `stacksScene.ts`; tune there, not per light.
- **Performance and access:** three.js is loaded lazily after the text paints; the rAF loop fully stops offscreen, in hidden tabs and while paused (it restarts on demand); devicePixelRatio is capped at 2; the render target is 0.75× device pixels; `prefers-reduced-motion` starts it paused; the reader can always Pause/Play. If WebGL fails, a painted-stripe fallback shows. Planned: a looping video of each mode as the no-WebGL fallback.

## 6a. The engravings ("The Reading Desk")

Code: `frontend/src/features/library/desk/engraving.ts` (the generator) and `ReadingDesk.tsx` (renders a scene into a box it fills). Mockups: `design/library-desk.html` (the full desk), `design/library-vibe.html` (the hand-colouring, option A).

- **Why a second medium:** the landing is the painted frontispiece (the world seen from outside); the Library is the book's interior plate. Same world, same palette and tokens, a different hand: related to the hero, not a copy of it.
- **Technique:** pure SVG line work generated in code from a fixed seed, so it is identical on every load. Tone is hatching; shadows are denser hatching; wood grain bends around knots; a small turbulence displacement makes every line hand-pulled. The wyrm is engraved along one sampled spine curve (tapering outline, staggered scales, dorsal ridge, flank shading).
- **One kit, composed into scenes.** Objects (grain, candle, open book, inkwell, wyrm, quill, spectacles, a loose dog-eared PDF page) are drawn in their own coordinates and placed per scene, each scene with its own size, light and planks. Compose a new scene for a new frame; never crop one scene into another frame (crops cut through objects).
  - **Plate I, the inkwell vignette** (600x500, used in the Library's panel): a candle in the top-left corner, a loose page from a PDF, the wyrm coiled round the inkwell with its chin on the page, the quill below. Everything sits inside the frame.
  - **The desk strip** (1200x340): candle, spectacles, open book, inkwell and wyrm, quill. Kept for wide bands; not on a page at the moment.
- **Day:** black ink on paper, lit from a window (lit areas have fewer lines; shadows fall down-right).
- **Night:** a **white-line engraving** (scratchboard): the desk is near-black, the candle is lit, light lines pool round it, and grain and objects fall off into the dark with distance.
- **Hand-colouring (Plate I):** loose watercolour washes in the hero's palette laid over the print, as colourists tinted old engravings: oak over the desk (a mottled noise field plus a wash), brass `#C9A15A` on the candle, vellum `#EAD9B0` on the page, bottle-green glass `#3E6A4A` with navy ink, gilt `#C99A48` and vellum on the wyrm, a red mark of ribbon on the page. Washes are ragged (noise-displaced), softened, with pigment pooling at the rim, and overrun the lines slightly. By day they blend with **multiply** (transparent pigment on paper); by night with **color** (the white lines take the wash's hue, the dark stays dark), plus an amber bloom from the candle.
- **Rules:** engravings are decoration only (`aria-hidden`, no text on them). Never put working UI or reading text over one. The wyrm's eyes stay the warmest point.
- **Gotcha:** a mask or filter with `userSpaceOnUse` units and no area of its own defaults to the visible window measured from the origin, so give every mask and filter an explicit area covering the whole scene.

## 7. Mascot: the Paper Wyrm

A small dragon-worm made of the books it reads. It is the brand's character, used in the hero, loaders, empty states and errors.

- **Body:** a chain of vellum page-blocks in two parchment tones (`#D6C298`, `#BFA678`) separated by gilt bands (`#C99A48`), with small page-corner fins along the back. Tapers toward the tail.
- **Head:** a rolled page with its spiral end visible, a gilt collar band, a page-shaped snout with a gold jaw line, and two scroll-curl horns tipped in gold.
- **Eye:** the one glowing point in the scene, amber (`#FFA235`), with a slit pupil. It blinks.
- **Tail:** a red silk bookmark ribbon (`#8E2A2A`) that flutters.
- **Behaviour:** burrows through the spines, weaving in front of and behind the books and leaving dark holes; every few seconds it turns to glance at the reader. Calm, curious, never frantic.
- **Use:** loaders show it burrowing across a progress line ("Reading p. 41 of 148"); empty states show it curled on a book; errors show it peering out of a hole. Keep it small in working screens; it is a companion, not decoration on every card.
- **Ink-glyph Wyrm (loading and waiting):** the mascot as an engraving made of dots, from the "Bookwyrm Hero Directions" design canvas. Code: `frontend/src/components/inkWyrm/` (`draw.ts` is the drawing, `InkWyrm` the canvas, `WyrmLoader` the page-level loader). The body is painted in greys on a tiny offscreen grid, then every cell is printed as a big or a small dim dot through a 4×4 ordered dither; the eye is the one spark of colour and blinks every 4.2 s.
  - **slither** = something is working: logging in, checking a link, loading a page; later indexing a PDF and generating a quiz (with a progress line and a "Reading p. 41 of 148" detail).
  - **coil** = waiting or empty: curled asleep on a stack of three books, motes drifting up. Not used on a page at the moment (the Library's wyrm is now the engraved one); kept for empty states and "review done".
  - **Colours** are tokens, so it follows day/night and can be re-inked locally: `--wyrm-dot` (ink), `--wyrm-dim` (frame), `--wyrm-eye` (`#C2621F` day, `#E3A64F` night).
  - **Sizes:** page loader 240×110 with 4px cells; small 84×76 with 2px cells. Below about 30 cells wide it stops reading as a wyrm, so it is never put inside buttons.
  - **Access:** decorative (`aria-hidden`) next to a text label that a `role="status"` region announces; standalone, it takes a `label` and becomes `role="img"`. Reduced motion draws one still frame. It only animates on screen in a visible tab.
- **Open item:** a close-up character sheet to refine the face before using it at large sizes.

## 8. Motion

- Ambient motion lives in the scene and in the Ink-glyph Wyrm loaders only (camera drift, lantern sway, wyrm, motes). UI motion is limited to hover/press feedback (150–200ms), the scroll-hint nudge, and progress rules (a filling bar; a slow sweep when the server is working and can't say how far along, shown solid under reduced motion).
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
