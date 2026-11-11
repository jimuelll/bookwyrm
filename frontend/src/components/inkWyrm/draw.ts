// The Ink-glyph Wyrm, ported from the "Bookwyrm Hero Directions" design canvas (Wyrm component).
//
// How it works: the wyrm is first painted in greys onto a tiny offscreen canvas (one pixel per dot
// cell). Each cell is then printed as a big dot or a small dim dot, using a 4×4 ordered-dither
// (Bayer) threshold on its brightness, so the creature looks engraved in type. The eye is the one
// spark of colour. Two moves: "slither" (working) and "coil" (waiting, curled on a stack of books).

export type WyrmMode = 'slither' | 'coil'

export interface WyrmColors {
  dot: string
  dim: string
  eye: string
}

interface Pt {
  x: number
  y: number
  r: number
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}
const grey = (l: number) => `rgb(${l},${l},${l})`

function blob(o: CanvasRenderingContext2D, x: number, y: number, r: number, hi: number, lo: number) {
  const g = o.createRadialGradient(x - r * 0.25, y - r * 0.5, r * 0.1, x, y, r)
  g.addColorStop(0, grey(hi))
  g.addColorStop(1, grey(lo))
  o.fillStyle = g
  o.beginPath()
  o.arc(x, y, r, 0, Math.PI * 2)
  o.fill()
}

function tri(o: CanvasRenderingContext2D, p: number[], l: number) {
  o.fillStyle = grey(l)
  o.beginPath()
  o.moveTo(p[0], p[1])
  o.lineTo(p[2], p[3])
  o.lineTo(p[4], p[5])
  o.closePath()
  o.fill()
}

/** Head with two horns and a snout; returns where the eye goes. */
function head(o: CanvasRenderingContext2D, hx: number, hy: number, R: number) {
  tri(o, [hx - R * 0.2, hy - R * 0.9, hx - R * 1.0, hy - R * 0.4, hx - R * 2.9, hy - R * 2.2], 150)
  tri(o, [hx + R * 0.15, hy - R * 1.05, hx - R * 0.55, hy - R * 0.75, hx - R * 1.7, hy - R * 2.7], 215)
  blob(o, hx, hy, R * 1.45, 245, 105)
  blob(o, hx + R * 1.3, hy + R * 0.4, R * 0.95, 230, 95)
  return { x: hx + R * 0.35, y: hy - R * 0.35 }
}

/** The fins along its back, always on the upper side of the body. */
function spines(o: CanvasRenderingContext2D, pts: Pt[], R: number, from: number, to: number) {
  const N = pts.length - 1
  for (let s = from; s <= to; s += 0.075) {
    const i = Math.round(s * N)
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)]
    let tx = b.x - a.x, ty = b.y - a.y
    const m = Math.hypot(tx, ty) || 1
    tx /= m
    ty /= m
    let nx = ty, ny = -tx
    if (ny > 0) {
      nx = -nx
      ny = -ny
    }
    const bx = p.x + nx * p.r * 0.7, by = p.y + ny * p.r * 0.7
    tri(o, [
      bx - tx * R * 0.35, by - ty * R * 0.35,
      bx + tx * R * 0.35, by + ty * R * 0.35,
      p.x + nx * (p.r + R * 0.85) - tx * R * 0.3, p.y + ny * (p.r + R * 0.85) - ty * R * 0.3,
    ], 205)
  }
}

/** A speckled ground line; `offset` scrolls it so the slither appears to travel. */
function ground(o: CanvasRenderingContext2D, cols: number, y: number, offset: number, density: number) {
  for (let gx = 0; gx < cols; gx++) {
    const n = Math.floor(gx + offset)
    if (hash(n) > density) {
      o.fillStyle = 'rgba(60,60,60,0.5)'
      o.fillRect(gx, y, 1, 1)
    }
    if (hash(n * 3.7 + 11) > 0.86) {
      o.fillStyle = 'rgba(60,60,60,0.45)'
      o.fillRect(gx, y + 2, 1, 1)
    }
  }
}

function slither(o: CanvasRenderingContext2D, cols: number, rows: number, t: number) {
  const gy = rows * 0.8, R = Math.max(2.2, rows * 0.075), L = cols * 0.58, x0 = cols * 0.17, N = 80, k = 4
  ground(o, cols, Math.round(gy) + 1, t * (k / (Math.PI * 4)) * L * 0.5, 0.32)
  const pts: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const s = i / N
    const hump = Math.max(0, Math.sin(Math.PI * 4 * s - t * k)) // the travelling wave along the body
    const neck = sm(0.8, 1, s)
    const r = R * (0.2 + 0.8 * sm(0, 0.5, s)) * (1 - 0.22 * Math.exp(-Math.pow((s - 0.9) / 0.05, 2)))
    const x = x0 + s * L - neck * R
    const y = gy - r - R * 2.2 * Math.pow(hump, 1.5) * (1 - neck) - neck * rows * 0.2 + neck * Math.sin(t * k) * R * 0.25
    pts.push({ x, y, r })
  }
  o.lineCap = 'round'
  ;[0.38, 0.64].forEach((s, j) => {
    // two little legs that step in time with the wave
    const p = pts[Math.round(s * N)]
    const fx = p.x + Math.sin(t * k - s * Math.PI * 4 + j) * R * 0.7
    const lift = Math.max(0, Math.sin(t * k - s * Math.PI * 4 + j + 1.2)) * R * 0.5
    o.strokeStyle = grey(150)
    o.lineWidth = R * 0.5
    o.beginPath()
    o.moveTo(p.x, p.y)
    o.lineTo(fx, gy - lift)
    o.stroke()
  })
  spines(o, pts, R, 0.22, 0.8)
  pts.forEach((p) => blob(o, p.x, p.y, p.r, 235, 95))
  const h = pts[N]
  return head(o, h.x + R * 0.6, h.y - R * 0.2, R)
}

function coil(o: CanvasRenderingContext2D, cols: number, rows: number, t: number) {
  const R = Math.max(2.2, rows * 0.068), cx = cols * 0.5, base = rows * 0.86, bh = rows * 0.075, N = 90
  ground(o, cols, Math.round(base) + 1, 0, 0.3)
  // the stack of three books it sleeps on
  const ws = [0.36, 0.31, 0.33], off = [0, -0.018, 0.014]
  for (let i = 0; i < 3; i++) {
    const w = cols * ws[i], x = cx - w / 2 + cols * off[i], y = base - (i + 1) * bh
    o.fillStyle = grey(70)
    o.fillRect(x, y, w, bh - 0.4)
    o.fillStyle = grey(235)
    o.fillRect(x + w - 1.2, y + 0.6, 1, bh - 1.6)
    o.fillStyle = grey(180)
    o.fillRect(x + 1, y, w - 2, 0.7)
  }
  const topY = base - 3 * bh, breath = 1 + 0.03 * Math.sin(t * 1.6)
  const pts: Pt[] = []
  for (let i = 0; i <= N; i++) {
    const s = i / N, th = Math.PI * 0.55 + s * Math.PI * 1.45
    const a = cols * 0.15 * (1 - 0.25 * s) * breath, b = rows * 0.085 * (1 - 0.25 * s) * breath
    const neck = sm(0.82, 1, s)
    const r = R * (0.25 + 0.75 * sm(0, 0.35, s)) * (1 - 0.2 * Math.exp(-Math.pow((s - 0.9) / 0.05, 2)))
    const x = cx + a * Math.cos(th) - neck * R * 0.6
    let y = topY - R * 0.8 - b * (1 - Math.sin(th)) - neck * rows * 0.17 + neck * Math.sin(t * 1.6) * R * 0.25
    if (s < 0.16) y += Math.sin(t * 2.4 + s * 25) * R * 0.7 * (1 - s / 0.16) // the tail flicks
    pts.push({ x, y, r })
  }
  spines(o, pts, R, 0.25, 0.8)
  pts.forEach((p) => blob(o, p.x, p.y, p.r, 235, 95))
  const h = pts[N]
  return head(o, h.x + R * 0.6, h.y - R * 0.2, R)
}

export interface DrawOptions {
  mode: WyrmMode
  width: number
  height: number
  cell: number
  colors: WyrmColors
  dpr: number
}

/**
 * Draw one frame at time `t` (seconds). `scratch` is a reusable offscreen canvas.
 * Returns false if the browser can't draw (no 2D canvas), so the caller can stop trying.
 */
export function drawWyrm(canvas: HTMLCanvasElement, scratch: HTMLCanvasElement, opt: DrawOptions, t: number): boolean {
  const { width: w, height: h, cell: cs, colors, dpr } = opt
  const W = Math.round(w * dpr), H = Math.round(h * dpr)
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const cols = Math.floor(w / cs), rows = Math.floor(h / cs)
  if (scratch.width !== cols || scratch.height !== rows) {
    scratch.width = cols
    scratch.height = rows
  }
  const o = scratch.getContext('2d', { willReadFrequently: true })
  if (!o || cols < 4 || rows < 4) return Boolean(o)
  o.clearRect(0, 0, cols, rows)
  const eye = opt.mode === 'coil' ? coil(o, cols, rows, t) : slither(o, cols, rows, t)

  // print every cell as a dot: bright cells above their dither threshold get a big dot
  const d = o.getImageData(0, 0, cols, rows).data
  const ox = (w - cols * cs) / 2, oy = (h - rows * cs) / 2
  const big = new Path2D(), small = new Path2D()
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4, a = d[i + 3] / 255
      if (a < 0.3) continue
      const lum = d[i] / 255, th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
      const px = ox + (x + 0.5) * cs, py = oy + (y + 0.5) * cs
      if (a > 0.65 && lum > th) {
        big.moveTo(px + cs * 0.38, py)
        big.arc(px, py, cs * 0.38, 0, Math.PI * 2)
      } else {
        small.moveTo(px + cs * 0.19, py)
        small.arc(px, py, cs * 0.19, 0, Math.PI * 2)
      }
    }
  }
  ctx.fillStyle = colors.dim
  ctx.fill(small)
  ctx.fillStyle = colors.dot
  ctx.fill(big)

  if (opt.mode === 'coil') {
    // a few motes drifting up past the sleeping wyrm
    ctx.fillStyle = colors.dim
    for (let k = 0; k < 7; k++) {
      const span = rows * 0.7, py = rows * 0.62 - ((t * 3 + k * 9.3) % span)
      const px = cols * 0.5 + Math.sin(k * 12.9 + t * 0.4) * cols * 0.22
      ctx.beginPath()
      ctx.arc(ox + (Math.round(px) + 0.5) * cs, oy + (Math.round(py) + 0.5) * cs, cs * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // the eye: a four-pointed spark with a soft glow, blinking every 4.2 seconds
  const blink = t % 4.2 < 0.14 ? 0.15 : 1
  const ex = ox + (eye.x + 0.5) * cs, ey = oy + (eye.y + 0.5) * cs
  const s = cs * 1.5 * blink * (0.9 + 0.15 * Math.sin(t * 5))
  ctx.fillStyle = colors.eye
  ctx.globalAlpha = 0.25
  ctx.beginPath()
  ctx.arc(ex, ey, s * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.moveTo(ex, ey - s)
  ctx.lineTo(ex + s * 0.22, ey - s * 0.22)
  ctx.lineTo(ex + s, ey)
  ctx.lineTo(ex + s * 0.22, ey + s * 0.22)
  ctx.lineTo(ex, ey + s)
  ctx.lineTo(ex - s * 0.22, ey + s * 0.22)
  ctx.lineTo(ex - s, ey)
  ctx.lineTo(ex - s * 0.22, ey - s * 0.22)
  ctx.closePath()
  ctx.fill()
  return true
}
