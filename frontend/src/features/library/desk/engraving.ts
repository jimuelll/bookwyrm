/**
 * Copperplate engravings of the reader's desk, drawn as SVG line work generated in code.
 *
 * How an engraver makes tone, and how this file does it:
 *   - shading is closely spaced parallel lines (hatching); lit areas simply have fewer lines;
 *   - by day it is ink on paper, lit from a window; by night it becomes a white-line engraving
 *     (scratchboard): the desk is dark and the candle "cuts" light out of it;
 *   - a seeded random generator makes the hand-cut irregularity identical on every load;
 *   - a little turbulence displaces every line by a pixel or two, like a hand-pulled print;
 *   - a scene can be hand-coloured, as old prints were: loose watercolour washes in the hero's palette
 *     laid over the lines (library.css blends them: multiply by day, "color" by night).
 *
 * One kit of objects (grain, candle, inkwell, wyrm, quill, a loose page...) is composed into scenes:
 *   - `inkwellVignetteSvg()` - the Library's side panel: the wyrm coiled round the inkwell, its chin
 *     on a page from a PDF, a candle in the corner and the quill below;
 *   - `readingDeskSvg()` - the original wide desk strip (kept for wide bands).
 * Engravings are decoration only (aria-hidden, no text). Colours are CSS custom properties, and
 * library.css shows/hides the `.day` / `.night` parts, so one markup serves both themes.
 */

type Pt = [number, number]

/** Where things go: the scene's size, its light, and what sits on the desk. */
interface Scene {
  w: number
  h: number
  /** the desk top's height; anything below it is the desk's front edge */
  deskH: number
  /** the candle flame, in scene coordinates: night light pools here and shadows fall away from it */
  light: Pt
  /** the planks' [top, bottom] edges */
  planks: [number, number][]
  /** two window panes' light shafts by day (SVG path data) */
  windowLight: string
  seed: number
  objects: (kit: Kit) => string
  /** optional hand-colouring: watercolour wash shapes laid over the print (see WASH below) */
  wash?: string
}

type Kit = ReturnType<typeof makeKit>

// ---------- deterministic randomness ----------
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n: number) => n.toFixed(1)
const pts = (list: Pt[]) => list.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')

/** The object drawers. Each draws in its own local coordinates; `place` puts it into the scene. */
function makeKit(scene: Scene) {
  const rnd = mulberry32(scene.seed)
  const r = (a: number, b: number) => a + (b - a) * rnd()
  const shadows: string[] = []
  const eyes: Pt[] = []

  // While an object is drawn, WRAP is its placement transform and toWorld maps its local points into
  // the scene, so its shadow can be placed (and aimed away from the candle) correctly.
  let WRAP = ''
  let toWorld = (x: number, y: number): Pt => [x, y]
  function place(tx: number, ty: number, s: number, ox: number, oy: number, draw: () => string) {
    WRAP = `translate(${tx} ${ty}) scale(${s}) translate(${-ox} ${-oy})`
    toWorld = (x, y) => [tx + (x - ox) * s, ty + (y - oy) * s]
    const out = `<g transform="${WRAP}">${draw()}</g>`
    WRAP = ''
    toWorld = (x, y) => [x, y]
    return out
  }

  /** Every object casts a shadow: down-right from the window by day, away from the candle by night. */
  function shadow(sil: string, cx: number, cy: number) {
    const [wx, wy] = toWorld(cx, cy)
    const dx = wx - scene.light[0]
    const dy = wy - scene.light[1]
    const d = Math.hypot(dx, dy) || 1
    const k = Math.min(16, 6 + d * 0.015)
    const one = (cls: string, ox: number, oy: number) =>
      `<g class="rd-sh-${cls} ${cls}" transform="translate(${f(ox)} ${f(oy)})"><g transform="${WRAP}"><g class="rd-sil">${sil}</g></g></g>`
    shadows.push(one('day', 8.4, 10.8), one('night', (dx / d) * k, (dy / d) * k))
  }

  // ---------- the desk: planks of grain lines bending around knots ----------
  function grain() {
    const W = scene.w
    let out = ''
    for (const [y0, y1] of scene.planks) {
      const span = y1 - y0
      const knots = [{ x: r(W * 0.1, W * 0.9), y: r(y0 + span * 0.27, y1 - span * 0.27), k: r(14, 22) }]
      if (rnd() < 0.75) knots.push({ x: r(W * 0.1, W * 0.9), y: r(y0 + span * 0.23, y1 - span * 0.23), k: r(9, 15) })
      const ph = r(0, 6)
      const fr = r(0.0018, 0.0035)
      const amp = r(3, 7)
      for (let y = y0 + 4; y < y1 - 2; y += r(4.5, 7.5)) {
        let d = ''
        for (let x = -12; x <= W + 12; x += 12) {
          let yy = y + amp * Math.sin(x * fr + ph + y * 0.012) + 1.1 * Math.sin(x * 0.021 + y)
          for (const k of knots) {
            // grain flows around a knot: lines near it are pushed away, more the closer they pass
            const dy = y - k.y
            const fall = Math.exp(-(((x - k.x) / (k.k * 4)) ** 2))
            yy += Math.sign(dy || 1) * fall * k.k * 1.7 * Math.exp(-Math.abs(dy) / (k.k * 2.4))
          }
          yy = Math.min(Math.max(yy, y0 + 1), y1 - 1)
          d += `${x < 0 ? 'M' : 'L'}${f(x)} ${f(yy)}`
        }
        // some lines break off, as a burin skips
        const dash = rnd() < 0.35 ? ` stroke-dasharray="${f(r(60, 260))} ${f(r(5, 24))}"` : ''
        out += `<path d="${d}" stroke-width="${f(r(0.5, 1.1))}" opacity="${f(r(0.35, 0.8))}"${dash}/>`
      }
      for (const k of knots)
        for (let i = 1; i <= 4; i++)
          out += `<ellipse cx="${f(k.x)}" cy="${f(k.y)}" rx="${f(k.k * 0.5 * i)}" ry="${f(k.k * 0.2 * i)}" stroke-width=".8" opacity=".8"/>`
    }
    for (const [, y1] of scene.planks.slice(0, -1)) out += `<path d="M0 ${y1 - 1.5}H${W}M0 ${y1 + 1.5}H${W}" stroke-width="1.1"/>` // seams
    return `<g class="rd-grain" fill="none" stroke="currentColor">${out}</g>`
  }

  /** Lines of "type": dashes of random length, with a short last line ending each paragraph. */
  function typeLines(x0: number, x1: number, y0: number, y1: number, gap: number, weight: number, indentUntil = -Infinity, indentX = x0) {
    let out = ''
    for (let y = y0, i = 0; y < y1; y += gap, i++) {
      const start = y < indentUntil ? indentX : x0
      const end = i % 7 === 6 ? r(start + (x1 - start) * 0.3, start + (x1 - start) * 0.7) : x1
      let x = start
      let d = ''
      while (x < end) {
        const w = r(gap * 0.7, gap * 3)
        d += `M${f(x)} ${f(y)}H${f(Math.min(end, x + w))}`
        x += w + r(gap * 0.35, gap * 0.55)
      }
      out += `<path d="${d}" stroke="currentColor" stroke-width="${weight}" opacity=".45"/>`
    }
    return out
  }

  // ---------- a loose page from a PDF: dog-eared corner, a heading, set type, a folio ----------
  function loosePage(w: number, h: number, rot: number) {
    const x = -w / 2
    const y = -h / 2
    const ear = 34
    const outline = `M${x} ${y}H${x + w - ear}L${x + w} ${y + ear}V${y + h}H${x}Z`
    shadow(`<path d="${outline}" transform="rotate(${rot})"/>`, 0, 0)
    return `<g transform="rotate(${rot})">
      <path d="${outline}" class="rd-paper" stroke-width="1.2"/>
      <path d="M${x + w - ear} ${y}V${y + ear}H${x + w}" class="rd-paper" stroke-width="1"/>
      <path d="M${x + w - ear} ${y}L${x + w} ${y + ear}" fill="none" stroke="currentColor" stroke-width=".8"/>
      <path d="M${x + w - ear + 4} ${y + 8}L${x + w - 8} ${y + ear - 4}" stroke="currentColor" stroke-width=".5" opacity=".7"/>
      <path d="M${x + 22} ${y + 30}H${x + w * 0.62}" stroke="currentColor" stroke-width="5" opacity=".55"/>
      <path d="M${x + 22} ${y + 42}H${x + w * 0.45}" stroke="currentColor" stroke-width="2.4" opacity=".4"/>
      ${typeLines(x + 22, x + w - 22, y + 62, y + h - 34, 11, 2)}
      <path d="M${-8} ${y + h - 16}H${8}" stroke="currentColor" stroke-width="1.6" opacity=".6"/>
    </g>`
  }

  // ---------- the open book: the wyrm device on the bookplate, "set type" on the right page ----------
  function openBook() {
    const L = 'M560 178 Q410 164 262 172 L262 568 Q410 560 560 574 Z'
    const R = 'M560 178 Q710 164 858 172 L858 568 Q710 560 560 574 Z'
    shadow('<rect x="246" y="158" width="628" height="432" rx="8"/>', 560, 374)
    let pages = ''
    // the page block: a few copies of each page, stepped outwards, read as the stacked edges
    for (let i = 5; i >= 0; i--)
      pages += `<path d="${L}" class="rd-paper" stroke-width=".7" transform="translate(${-i * 2} ${i * 1.7})"/><path d="${R}" class="rd-paper" stroke-width=".7" transform="translate(${i * 2} ${i * 1.7})"/>`
    const cover = `<rect x="246" y="158" width="628" height="432" rx="8" class="rd-paper" stroke-width="1.3"/><rect x="246" y="158" width="628" height="432" rx="8" fill="url(#rd-leather)" opacity=".75"/>`
    // bookplate frame: a rule, then an inner rule with concave corners
    const cr = (x: number, y: number, w: number, h: number, c: number) =>
      `M${x + c} ${y}H${x + w - c}A${c} ${c} 0 0 0 ${x + w} ${y + c}V${y + h - c}A${c} ${c} 0 0 0 ${x + w - c} ${y + h}H${x + c}A${c} ${c} 0 0 0 ${x} ${y + h - c}V${y + c}A${c} ${c} 0 0 0 ${x + c} ${y}Z`
    let plate = `<rect x="296" y="222" width="230" height="298" fill="none" stroke="currentColor" stroke-width="1.2"/>
      <path d="${cr(304, 230, 214, 282, 14)}" fill="none" stroke="currentColor" stroke-width=".7"/>`
    for (const [x, y] of [[304, 230], [518, 230], [304, 512], [518, 512]]) plate += `<circle cx="${x}" cy="${y}" r="3.2" class="rd-ink"/>`
    plate += `<g transform="translate(375 300) scale(2.4)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 22c3-6 6 2 9-3s6 3 9-2c2-3 4-3 6-1"/><path d="M24 14l2-5M27 15l3-4"/><circle cx="25.5" cy="17.5" r="1" fill="currentColor"/></g>
      <path d="M340 420H480M360 432H460" stroke="currentColor" stroke-width="1"/>`
    const type = '<path d="M606 214h46v46h-46z" fill="url(#rd-xhd)" stroke="currentColor" stroke-width=".8"/>' + typeLines(606, 830, 222, 540, 15, 2.4, 262, 662)
    const ribbon = '<path class="rd-ribbon" d="M566 166 C568 300 592 450 590 604 L584 620 L595 610 L606 622 L600 604 C602 450 578 300 576 166 Z"/>'
    return `<g>${cover}${pages}
      <rect x="490" y="160" width="140" height="430" fill="url(#rd-h45)" mask="url(#rd-gutter)" clip-path="url(#rd-pages)"/>
      <path d="M560 178V574" stroke="currentColor" stroke-width="1"/>${plate}${type}${ribbon}</g>`
  }

  // ---------- the candle in its brass chamberstick (local centre 190,150) ----------
  function candle() {
    const cx = 190
    const cy = 150
    shadow(`<circle cx="${cx}" cy="${cy}" r="78"/><circle cx="${cx + 86}" cy="${cy + 44}" r="22"/>`, cx + 20, cy + 20)
    const blob: Pt[] = []
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 14) {
      const rr = 38 + (Math.sin(a * 5) + Math.sin(a * 3 + 1)) * 3.5
      blob.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
    }
    // the dish: a hatched disc with a paper disc offset up-left on top leaves a shaded crescent
    return `<g>
      <path d="M${cx + 50} ${cy + 22}L${cx + 72} ${cy + 34}L${cx + 66} ${cy + 46}L${cx + 44} ${cy + 36}Z" class="rd-paper" stroke-width="1"/>
      <circle cx="${cx + 86}" cy="${cy + 44}" r="22" class="rd-paper" stroke-width="1.2"/><circle cx="${cx + 86}" cy="${cy + 44}" r="22" fill="url(#rd-h45d)"/>
      <circle cx="${cx + 86}" cy="${cy + 44}" r="12" class="rd-desk" stroke="currentColor" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="78" class="rd-paper" stroke-width="1.3"/><circle cx="${cx}" cy="${cy}" r="78" fill="url(#rd-h45d)"/>
      <circle cx="${cx - 6}" cy="${cy - 6}" r="72" class="rd-paper" stroke="none"/>
      <circle cx="${cx}" cy="${cy}" r="70" fill="none" stroke="currentColor" stroke-width=".7"/>
      <circle cx="${cx}" cy="${cy}" r="62" fill="none" stroke="currentColor" stroke-width=".5" stroke-dasharray="2 3"/>
      <path d="M${pts(blob)}Z" class="rd-paper" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="29" class="rd-paper" stroke-width="1.2"/><circle cx="${cx}" cy="${cy}" r="29" fill="url(#rd-h45)" opacity=".5"/>
      <circle cx="${cx - 3}" cy="${cy - 3}" r="21" class="rd-paper" stroke-width=".6"/>
      <circle cx="${cx}" cy="${cy}" r="3" class="rd-ink"/>
      <path class="day" d="M${cx + 1} ${cy - 2} c 10 -14 -6 -22 6 -36 s -2 -22 10 -30" fill="none" stroke="currentColor" stroke-width=".7" stroke-dasharray="3 4" opacity=".6"/>
      <g class="night"><circle cx="${cx}" cy="${cy}" r="12" class="rd-flame" opacity=".9"/><circle cx="${cx}" cy="${cy}" r="5" fill="#fff6e0"/></g>
    </g>`
  }

  // ---------- the cut-glass inkwell (local centre 1010,175) ----------
  function inkwell() {
    const cx = 1010
    const cy = 175
    const oct = (rad: number): Pt[] =>
      Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 + 32.5) * Math.PI) / 180
        return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
      })
    const o1 = oct(64)
    const o2 = oct(42)
    shadow(`<path d="M${pts(o1)}Z"/>`, cx, cy)
    let facets = ''
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8
      const d = `M${pts([o1[i], o1[j], o2[j], o2[i]])}Z`
      facets += `<path d="${d}" class="rd-paper" stroke-width=".8"/>`
      if (i <= 2) facets += `<path d="${d}" fill="url(#rd-${i === 1 ? 'h45d' : 'h45'})"/>` // the facets turned from the light
    }
    return `<g>${facets}
      <path d="M${pts(o2)}Z" class="rd-paper" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="30" class="rd-paper" stroke-width="1.2"/>
      <circle cx="${cx}" cy="${cy}" r="23" class="rd-ink" opacity=".92"/>
      <path d="M${cx - 15} ${cy - 8} A17 17 0 0 1 ${cx - 4} ${cy - 17}" fill="none" stroke="var(--page)" stroke-width="2.2" stroke-linecap="round"/>
    </g>`
  }

  // ---------- the wyrm, coiled round the inkwell (same local frame), its head pointing left ----------
  function wyrm() {
    // The body is engraved along one spine curve: tail curl -> coil round the inkwell -> neck.
    // We sample the curve into a dense polyline, give it a tapering width, then cut overlapping scales,
    // a dorsal ridge and flank shading, each turned to follow the curve's direction at that point.
    const spine = sampleSpine()
    const Lt = spine.length
    const width = (t: number) => (t < 0.22 ? 2 + 20 * Math.pow(t / 0.22, 0.8) : t < 0.86 ? 22 : 22 - 7 * ((t - 0.86) / 0.14))
    const left: Pt[] = []
    const right: Pt[] = []
    for (let s = 0; s <= Lt; s += 2) {
      const q = spine.at(s)
      const w = width(s / Lt) / 2
      left.push([q.x + q.nx * w, q.y + q.ny * w])
      right.push([q.x - q.nx * w, q.y - q.ny * w])
    }
    const outline = `M${pts(left)}L${pts(right.reverse())}Z`
    let scales = ''
    let ridge = ''
    let shade = ''
    for (let s = 14; s < Lt - 4; s += 6.5) {
      const q = spine.at(s)
      const w = width(s / Lt) / 2
      const rows = w > 8 ? [-0.55, 0, 0.55] : w > 4 ? [0] : []
      const step = Math.round(s / 6.5)
      const off = (step % 2) * 0.27 // alternate rows are staggered, like real scales
      for (const k of rows) {
        const o = (k + (k ? off * Math.sign(k) : 0)) * w
        const cx = q.x + q.nx * o
        const cy = q.y + q.ny * o
        const h = Math.min(3.4, w * 0.32)
        // a "U" whose belly points to the tail: scales overlap from the head backwards
        scales += `M${f(cx + q.nx * h)} ${f(cy + q.ny * h)}Q${f(cx - q.tx * 5)} ${f(cy - q.ty * 5)} ${f(cx - q.nx * h)} ${f(cy - q.ny * h)}`
      }
      if (w > 5 && step % 2 === 0) {
        const a: Pt = [q.x + q.tx * 3, q.y + q.ty * 3]
        const b: Pt = [q.x + q.nx * 1.8, q.y + q.ny * 1.8]
        const c: Pt = [q.x - q.tx * 3, q.y - q.ty * 3]
        const d: Pt = [q.x - q.nx * 1.8, q.y - q.ny * 1.8]
        ridge += `M${pts([a, b, c, d])}Z`
      }
    }
    for (let s = 6; s < Lt; s += 2.6) {
      const q = spine.at(s)
      const w = width(s / Lt) / 2
      const len = w * 0.45
      shade += `M${f(q.x - q.nx * w)} ${f(q.y - q.ny * w)}L${f(q.x - q.nx * (w - len))} ${f(q.y - q.ny * (w - len))}`
    }
    shadow(`<path d="${outline}"/>`, 1010, 175)
    eyes.push(toWorld(873, 240), toWorld(873, 256))
    return `<g><path d="${outline}" class="rd-paper" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="${shade}" stroke="currentColor" stroke-width=".6" opacity=".85"/>
      <path d="${scales}" fill="none" stroke="currentColor" stroke-width=".7"/>
      <path d="${ridge}" class="rd-ink"/>
      <path d="M886 238 L908 220 L902 236 Z M886 262 L910 278 L902 262 Z" class="rd-paper" stroke-width="1"/>
      <path d="M900 236 C886 226 862 230 846 238 L834 246 L846 254 C862 266 886 270 900 260 C906 254 906 242 900 236 Z" class="rd-paper" stroke-width="1.3"/>
      <path d="M894 240 C880 236 866 238 856 243 M894 256 C880 260 866 258 856 253" fill="none" stroke="currentColor" stroke-width=".6"/>
      <path d="M884 248 L868 248" stroke="currentColor" stroke-width=".7" stroke-dasharray="2 2.5"/>
      <path d="M876 233 Q870 236 866 240 M876 263 Q870 260 866 256" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <circle cx="842" cy="244" r="1.3" class="rd-ink"/><circle cx="842" cy="252" r="1.3" class="rd-ink"/>
      <circle cx="873" cy="240" r="3.2" class="rd-eye" stroke="currentColor" stroke-width=".7"/>
      <circle cx="873" cy="256" r="3.2" class="rd-eye" stroke="currentColor" stroke-width=".7"/></g>`
  }

  // ---------- the quill: a shaft, two vanes of different widths, and barbs swept back (local 905,332 -> 1172,418) ----------
  function quill() {
    const A: Pt = [905, 332]
    const B: Pt = [1172, 418]
    const L = Math.hypot(B[0] - A[0], B[1] - A[1])
    const u: Pt = [(B[0] - A[0]) / L, (B[1] - A[1]) / L]
    const n: Pt = [-u[1], u[0]]
    const P = (t: number, s = 0): Pt => [A[0] + u[0] * L * t + n[0] * s, A[1] + u[1] * L * t + n[1] * s]
    const w1 = (t: number) => (t < 0.25 ? 0 : 26 * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.25) / 0.76)), 0.55))
    const w2 = (t: number) => (t < 0.3 ? 0 : -13 * Math.pow(Math.sin(Math.PI * Math.min(1, (t - 0.3) / 0.71)), 0.6))
    const side1: Pt[] = []
    const side2: Pt[] = []
    for (let t = 0.25; t <= 1.001; t += 0.02) side1.push(P(t, w1(t)))
    for (let t = 1; t >= 0.3; t -= 0.02) side2.push(P(t, w2(t)))
    let barbs = ''
    for (let t = 0.27; t < 0.99; t += 0.011) {
      barbs += `M${pts([P(t), P(Math.min(1, t + 0.05), w1(t) * 0.96)])}`
      if (t > 0.31) barbs += `M${pts([P(t), P(Math.min(1, t + 0.04), w2(t) * 0.96)])}`
    }
    const vane = `M${pts(side1)}L${pts(side2)}Z`
    shadow(`<path d="${vane}"/>`, 1040, 375)
    return `<g><path d="${vane}" class="rd-paper" stroke-width="1"/>
      <path d="${barbs}" stroke="currentColor" stroke-width=".55" opacity=".8"/>
      <path d="M${pts([P(0), P(1)])}" stroke="currentColor" stroke-width="1.6"/>
      <path d="M${pts([P(0), P(0.1, 4), P(0.1, -4)])}Z" class="rd-paper" stroke-width="1"/>
      <circle cx="${A[0]}" cy="${A[1]}" r="2.6" class="rd-ink"/></g>`
  }

  // ---------- folded reading spectacles (local centre 560,660) ----------
  function spectacles() {
    const a: Pt = [520, 664]
    const b: Pt = [598, 656]
    shadow(`<circle cx="${a[0]}" cy="${a[1]}" r="30"/><circle cx="${b[0]}" cy="${b[1]}" r="30"/>`, 560, 660)
    const lens = ([x, y]: Pt) => `<circle cx="${x}" cy="${y}" r="30" class="rd-paper" stroke-width="2.4" fill-opacity=".35"/>
      <circle cx="${x}" cy="${y}" r="26.5" fill="none" stroke="currentColor" stroke-width=".6"/>
      <path d="M${x - 14} ${y - 4} L${x - 4} ${y - 16} M${x - 10} ${y + 2} L${x + 2} ${y - 12}" stroke="currentColor" stroke-width=".8" opacity=".7"/>`
    return `<g>${lens(a)}${lens(b)}
      <path d="M549 660 Q559 648 569 656" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <path d="M492 668 L612 676 M492 668 l-6 -6 M626 652 L506 688 M626 652 l7 -4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></g>`
  }

  return { place, grain, loosePage, openBook, candle, inkwell, wyrm, quill, spectacles, shadows, eyes }
}

/** Assembles a scene: the desk, its grain, the day/night tone layers, shadows, objects and glows. */
function engrave(scene: Scene): string {
  const { w: W, h: H, deskH, light } = scene
  const kit = makeKit(scene)
  // grain first, so the desk's look doesn't depend on which objects come after it in the random stream
  const grainSvg = kit.grain()
  const objects = scene.objects(kit)
  const edge =
    deskH < H
      ? `<rect y="${deskH}" width="${W}" height="${H - deskH}" class="rd-desk"/>
    <rect y="${deskH}" width="${W}" height="${H - deskH}" fill="url(#rd-vert)" opacity=".8"/>
    <path d="M0 ${deskH + 0.5}H${W}M0 ${deskH + 5}H${W}" stroke="currentColor" stroke-width="1.2"/>`
      : ''
  // A mask with maskUnits="userSpaceOnUse" and no area of its own defaults to the visible window measured
  // from the origin, so give every mask the whole scene explicitly.
  const area = `x="-20" y="-20" width="${W + 40}" height="${H + 40}"`
  const reach = Math.hypot(W, H)

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
<defs>
  <pattern id="rd-h45" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="currentColor" stroke-width=".7"/></pattern>
  <pattern id="rd-h45d" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V3" stroke="currentColor" stroke-width=".9"/></pattern>
  <pattern id="rd-xhd" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V3M0 0H3" stroke="currentColor" stroke-width=".6"/></pattern>
  <pattern id="rd-vert" width="3" height="10" patternUnits="userSpaceOnUse"><path d="M0 0V10" stroke="currentColor" stroke-width=".8"/></pattern>
  <pattern id="rd-leather" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><path d="M0 0V4M0 0H4" stroke="currentColor" stroke-width=".45"/></pattern>
  <pattern id="rd-tone" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 0V6" stroke="currentColor" stroke-width=".8"/></pattern>

  <filter id="rd-wobble" filterUnits="userSpaceOnUse" ${area}><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter>
  <filter id="rd-soft"><feGaussianBlur stdDeviation="5"/></filter>

  <clipPath id="rd-pages"><path d="M560 178 Q410 164 262 172 L262 568 Q410 560 560 574 Q710 560 858 568 L858 172 Q710 164 560 178Z"/></clipPath>
  <linearGradient id="rd-gutter-g" x1="490" x2="630" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  <mask id="rd-gutter" maskUnits="userSpaceOnUse" x="490" y="150" width="140" height="450"><rect x="490" y="150" width="140" height="450" fill="url(#rd-gutter-g)"/></mask>

  <!-- day: shade everywhere except where the window's light falls (two panes, a mullion between) -->
  <radialGradient id="rd-vign" cx="${W / 2}" cy="${deskH / 2}" r="${f(reach * 0.55)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#333"/><stop offset="1" stop-color="#ddd"/></radialGradient>
  <mask id="rd-day-tone" maskUnits="userSpaceOnUse" ${area}><rect width="${W}" height="${deskH}" fill="url(#rd-vign)"/>
    <g filter="url(#rd-soft)" fill="#000"><path d="${scene.windowLight}"/></g></mask>
  <!-- night: the candle cuts light lines out of the dark around it, and everything fades with distance -->
  <radialGradient id="rd-candle" cx="${light[0]}" cy="${light[1]}" r="${f(reach * 0.33)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#999"/><stop offset="1" stop-color="#000"/></radialGradient>
  <mask id="rd-night-tone" maskUnits="userSpaceOnUse" ${area}><rect width="${W}" height="${H}" fill="url(#rd-candle)"/></mask>
  <radialGradient id="rd-fall-g" cx="${light[0]}" cy="${light[1]}" r="${f(reach * 0.92)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#999"/><stop offset="1" stop-color="#262626"/></radialGradient>
  <mask id="rd-fall-grain" maskUnits="userSpaceOnUse" ${area}><rect width="${W}" height="${H}" fill="url(#rd-fall-g)"/></mask>
  <radialGradient id="rd-fall-o" cx="${light[0]}" cy="${light[1]}" r="${f(reach * 0.92)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#8a8a8a"/></radialGradient>
  <mask id="rd-fall-objects" maskUnits="userSpaceOnUse" ${area}><rect width="${W}" height="${H}" fill="url(#rd-fall-o)"/></mask>
  <!-- a watercolour wash: ragged edges (shapes displaced by noise), softened, with pigment pooling at the rim -->
  <filter id="rd-wc" filterUnits="userSpaceOnUse" ${area}>
    <feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="3" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="20" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="2.4" result="b"/>
    <feMorphology in="b" operator="erode" radius="3" result="inner"/>
    <feComposite in="b" in2="inner" operator="out" result="rim"/>
    <feComponentTransfer in="rim" result="rim2"><feFuncA type="linear" slope=".6"/></feComponentTransfer>
    <feMerge><feMergeNode in="b"/><feMergeNode in="rim2"/></feMerge>
  </filter>
  <!-- uneven pigment across the desk: a soft, stretched noise field tinted oak -->
  <filter id="rd-mottle" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
    <feTurbulence type="fractalNoise" baseFrequency=".008 .02" numOctaves="3" seed="3"/>
    <feColorMatrix values="0 0 0 0 .62  0 0 0 0 .42  0 0 0 0 .24  0 0 0 1.3 -.35"/>
  </filter>
  <radialGradient id="rd-amber"><stop offset="0" stop-color="#ffb24d" stop-opacity=".55"/><stop offset=".35" stop-color="#ff9a3c" stop-opacity=".18"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
  <radialGradient id="rd-glow"><stop offset="0" stop-color="var(--accent)" stop-opacity=".38"/><stop offset=".4" stop-color="var(--accent)" stop-opacity=".12"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" class="rd-desk"/>
<g filter="url(#rd-wobble)">
  ${grainSvg}
  ${edge}
  <rect class="day" width="${W}" height="${deskH}" fill="url(#rd-tone)" mask="url(#rd-day-tone)" opacity=".7"/>
  <rect class="night" width="${W}" height="${deskH}" fill="url(#rd-tone)" mask="url(#rd-night-tone)" opacity=".75"/>
  <g>${kit.shadows.join('')}</g>
  <g class="rd-objects">${objects}</g>
</g>
<g class="rd-glow night">
  <circle cx="${light[0]}" cy="${light[1]}" r="${f(reach * 0.25)}" fill="url(#rd-glow)"/>
  ${kit.eyes.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="8" fill="url(#rd-glow)"/>`).join('')}
</g>${
    scene.wash
      ? `
<rect class="rd-wash" width="${W}" height="${H}" filter="url(#rd-mottle)" opacity=".85"/>
<g class="rd-wash" filter="url(#rd-wc)">${scene.wash}</g>
<circle class="rd-wash-glow night" cx="${light[0]}" cy="${light[1]}" r="${f(reach * 0.54)}" fill="url(#rd-amber)"/>`
      : ''
  }
</svg>`
}

/** The wide desk strip, 1200x340: candle | spectacles | open book | wyrm & inkwell | quill. */
export function readingDeskSvg(): string {
  return engrave({
    w: 1200,
    h: 340,
    deskH: 300,
    light: [150, 122],
    planks: [
      [0, 150],
      [150, 300],
    ],
    windowLight: 'M420 -20H600L700 300H520Z M625 -20H805L905 300H725Z',
    seed: 11,
    objects: (k) =>
      [
        k.place(150, 122, 0.8, 190, 150, k.candle),
        k.place(600, 165, 0.6, 560, 374, k.openBook),
        k.place(950, 140, 0.78, 1010, 175, () => k.inkwell() + k.wyrm()),
        k.place(1066, 252, 0.62, 1040, 375, k.quill),
        k.place(250, 262, 0.55, 560, 660, k.spectacles),
      ].join(''),
  })
}

/**
 * The Library's side-panel vignette, 600x500, composed for its frame rather than cropped from the strip:
 * a candle in the top-left corner (the night light), a loose page from a PDF, the wyrm coiled round the
 * inkwell with its chin resting on the page, and the quill below. Everything sits inside the frame.
 * Hand-coloured: oak desk, brass candle, bottle-green glass, a gilt-and-vellum wyrm, as in the hero.
 */
export function inkwellVignetteSvg(): string {
  return engrave({
    w: 600,
    h: 500,
    deskH: 500,
    light: [70, 66],
    planks: [
      [0, 250],
      [250, 500],
    ],
    windowLight: 'M150 -20H270L430 520H310Z M295 -20H415L575 520H455Z',
    seed: 23,
    objects: (k) =>
      [
        k.place(70, 66, 0.5, 190, 150, k.candle),
        k.place(168, 300, 1, 0, 0, () => k.loosePage(196, 252, -7)),
        k.place(370, 196, 1, 1010, 175, () => k.inkwell() + k.wyrm()),
        k.place(410, 418, 0.84, 1040, 375, k.quill),
      ].join(''),
    // Hand-colouring in the hero's palette. Washes are loose, as a colourist's would be: they follow the
    // objects roughly and overrun the lines a little. Positions match the placements above.
    wash: `
      <rect x="-20" y="-20" width="640" height="540" fill="#b98a55" opacity=".28"/>
      <circle cx="70" cy="66" r="41" fill="#c9a15a" opacity=".75"/><circle cx="113" cy="88" r="12" fill="#c9a15a" opacity=".75"/>
      <rect x="-98" y="-126" width="196" height="252" fill="#ead9b0" opacity=".55" transform="translate(168 300) rotate(-7)"/>
      <circle cx="370" cy="196" r="62" fill="#3e6a4a" opacity=".7"/>
      <circle cx="370" cy="196" r="23" fill="#1e2c44" opacity=".85"/>
      <path d="M420 256 A78 78 0 1 0 310 246" fill="none" stroke="#c99a48" stroke-width="24" stroke-linecap="round" opacity=".75"/>
      <path d="M420 256 C432 282 476 296 494 276 C504 262 494 250 484 258" fill="none" stroke="#c99a48" stroke-width="12" stroke-linecap="round" opacity=".7"/>
      <path d="M310 246 C292 262 268 274 238 268" fill="none" stroke="#c99a48" stroke-width="18" stroke-linecap="round" opacity=".75"/>
      <ellipse cx="226" cy="270" rx="34" ry="17" fill="#cdb78c" opacity=".8"/>
      <path d="M300 384 L520 452" stroke="#d8c8a2" stroke-width="20" stroke-linecap="round" opacity=".45"/>
      <path d="M210 434 L246 440" stroke="#8e2a2a" stroke-width="7" opacity=".5"/>`,
  })
}

// ---------- the wyrm's spine, sampled without the DOM ----------
// Browsers can measure an SVG path (getPointAtLength), but jsdom can't, and we only need one curve,
// so we sample it ourselves: two cubic Béziers for the tail, a 270° arc round the inkwell, one Bézier for the neck.

interface SpinePoint {
  x: number
  y: number
  tx: number // unit tangent
  ty: number
  nx: number // unit normal
  ny: number
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, steps = 60): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    out.push([
      m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
      m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

function sampleSpine() {
  const c: Pt = [1010, 175]
  const R = 78
  const a0 = Math.atan2(235 - c[1], 1060 - c[0]) // where the tail meets the coil
  const a1 = Math.atan2(226 - c[1], 950 - c[0]) - Math.PI * 2 // ... going the long way round, anticlockwise
  const arc: Pt[] = []
  for (let i = 0; i <= 160; i++) {
    const a = a0 + ((a1 - a0) * i) / 160
    arc.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)])
  }
  const poly: Pt[] = [
    ...cubic([1114, 234], [1126, 226], [1136, 240], [1124, 254], 30),
    ...cubic([1124, 254], [1108, 272], [1074, 262], [1060, 235], 40).slice(1),
    ...arc.slice(1),
    ...cubic(arc[arc.length - 1], [936, 242], [912, 252], [894, 250], 40).slice(1),
  ]
  const cum = [0]
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]))
  const length = cum[cum.length - 1]

  function at(s: number): SpinePoint {
    const t = Math.min(Math.max(s, 0), length)
    let i = 1
    while (i < cum.length - 1 && cum[i] < t) i++
    const seg = cum[i] - cum[i - 1] || 1
    const k = (t - cum[i - 1]) / seg
    const [x0, y0] = poly[i - 1]
    const [x1, y1] = poly[i]
    const dx = x1 - x0
    const dy = y1 - y0
    const m = Math.hypot(dx, dy) || 1
    return { x: x0 + dx * k, y: y0 + dy * k, tx: dx / m, ty: dy / m, nx: -dy / m, ny: dx / m }
  }
  return { length, at }
}
