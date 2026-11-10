import * as THREE from 'three'
import { watercolorFragment, watercolorVertex } from './watercolorShader'

/**
 * "The Stacks": a front-on library wall (instanced books, scrolls, ladder, swaying lantern)
 * with the paper wyrm burrowing through one shelf, rendered through a watercolour pass.
 *
 * The canvas covers the whole hero; the camera is offset and its lens fitted so the
 * interesting part of the scene sits inside `plate` (the framed window on the right page).
 */

export interface StacksOptions {
  dark: boolean
  running: boolean
}

// three r155+ uses physical light units. These factors map the look tuned under legacy
// lighting onto physical units: ambient/directional lose the old PI factor, punctual lights
// with decay 2 fall off with inverse-square distance (tuned at ~3.5 units from the wall).
const AMBIENT_SCALE = Math.PI
const PUNCTUAL_SCALE = 23

const LIGHT = {
  hemiNight: 0.7 * AMBIENT_SCALE,
  hemiDay: 1.05 * AMBIENT_SCALE,
  sunDay: 1.8 * AMBIENT_SCALE,
  lampNight: 2.0 * PUNCTUAL_SCALE,
  spotNight: 1.7 * PUNCTUAL_SCALE,
  eye: 0.25,
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function mulberry(seedStart: number) {
  let seed = seedStart
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const col = (hex: string) => new THREE.Color(hex) // hex is sRGB; three stores it linear

interface Book { x: number; y: number; z: number; w: number; h: number; d: number; c: string }

export class StacksScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 60)
  private rt: THREE.WebGLRenderTarget
  private post: THREE.ShaderMaterial
  private postScene = new THREE.Scene()
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private disposers: Array<() => void> = []

  private dark: boolean
  private running: boolean
  private visible = true
  private needsFrame = true
  private t = 6
  private last = performance.now()
  private raf = 0
  private disposed = false
  private mouse = { x: 0, y: 0, tx: 0, ty: 0 }

  // animated parts
  private hemi!: THREE.HemisphereLight
  private sun!: THREE.DirectionalLight
  private lampLight!: THREE.PointLight
  private spot!: THREE.SpotLight
  private glassMat!: THREE.MeshStandardMaterial
  private shaftMat!: THREE.MeshBasicMaterial
  private dustMat!: THREE.PointsMaterial
  private dustGeo!: THREE.BufferGeometry
  private dustPos!: Float32Array
  private dustSeed!: Float32Array
  private pivot!: THREE.Group
  private eyeMat!: THREE.MeshStandardMaterial
  private poseWyrm!: (t: number) => void

  private host: HTMLElement
  private plate: HTMLElement

  constructor(canvas: HTMLCanvasElement, host: HTMLElement, plate: HTMLElement, opts: StacksOptions) {
    this.host = host
    this.plate = plate
    this.dark = opts.dark
    this.running = opts.running
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    })
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uDark: { value: 1 },
        uTime: { value: 0 },
        uPaper: { value: new THREE.Vector3(0.925, 0.886, 0.806) },
        uNight: { value: new THREE.Vector3(0.066, 0.052, 0.058) },
      },
      vertexShader: watercolorVertex,
      fragmentShader: watercolorFragment,
      depthTest: false,
      depthWrite: false,
    })
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post))

    this.build()
    this.applyTheme()
    this.bindEvents()
    this.resize()
    this.kick()
  }

  setDark(dark: boolean) {
    if (dark === this.dark) return
    this.dark = dark
    this.applyTheme()
  }

  setRunning(running: boolean) {
    this.running = running
    this.needsFrame = true
    this.kick()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.disposers.forEach((d) => d())
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.rt.dispose()
    this.post.dispose()
    this.renderer.dispose()
  }

  // ---------------------------------------------------------------- scene
  private build() {
    const { scene } = this
    const rnd = mulberry(20261111)
    const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
    const unit = new THREE.BoxGeometry(1, 1, 1)
    const dummy = new THREE.Object3D()

    // shelving
    const SH = 1.5, BW = 2.4, BAYS = 12, X0 = (-BW * BAYS) / 2, ROWS = 9, BACK = -0.92, WY_ROW = 4
    const woodMat = new THREE.MeshStandardMaterial({ color: col('#3A2315'), roughness: 0.82 })
    const darkWood = new THREE.MeshStandardMaterial({ color: col('#24150C'), roughness: 0.9 })
    const backMat = new THREE.MeshStandardMaterial({ color: col('#150D08'), roughness: 1 })
    const addBox = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const m = new THREE.Mesh(unit, mat)
      m.position.set(x, y, z); m.scale.set(w, h, d); m.castShadow = true; m.receiveShadow = true
      scene.add(m)
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 18), backMat)
    back.position.set(0, 8, BACK); back.receiveShadow = true; scene.add(back)
    for (let b = 0; b <= BAYS; b++) addBox(darkWood, X0 + b * BW, 7.05, -0.44, 0.13, 14.1, 0.97)
    for (let k = 0; k <= ROWS; k++) addBox(woodMat, 0, k * SH + 0.035, -0.44, BW * BAYS + 0.2, 0.07, 0.96)
    addBox(woodMat, 0, ROWS * SH + 0.35, -0.38, BW * BAYS + 0.6, 0.5, 1.1)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ color: col('#2A1A10'), roughness: 0.95 }))
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 5); floor.receiveShadow = true; scene.add(floor)

    // books, bands, scrolls
    const leather = ['#7A2A22', '#8E3A2A', '#5B1E1A', '#3E6A4A', '#2E5640', '#2C4A6A', '#3A4E78', '#7A5634', '#A07A44', '#4A3324', '#C9B184', '#6E2F45', '#56603A']
    const books: Book[] = []
    const bands: Array<{ x: number; y: number; z: number; w: number; c: string }> = []
    const scrolls: Array<{ x: number; y: number; z: number; r: number; len: number; c: string }> = []
    const shelfBooks: Book[][] = Array.from({ length: ROWS }, () => [])
    for (let b = 0; b < BAYS; b++) {
      const bx0 = X0 + b * BW + 0.08, bx1 = X0 + (b + 1) * BW - 0.08
      for (let k = 0; k < ROWS; k++) {
        const yb = k * SH + 0.07, avail = SH - 0.12, r = rnd()
        let x = bx0 + 0.02
        if (r < 0.09 && k !== WY_ROW) {
          const rad = 0.11 + rnd() * 0.04
          for (let row = 0; row < 3; row++) {
            for (let cx = bx0 + rad + 0.03 + (row % 2) * rad; cx < bx1 - rad; cx += rad * 2.04) {
              const cy = yb + rad + row * rad * 1.74
              if (cy + rad > yb + avail) continue
              const len = 0.6 + rnd() * 0.25
              scrolls.push({ x: cx, y: cy, z: BACK + len / 2 + rnd() * 0.12, r: rad * (0.88 + rnd() * 0.12), len, c: pick(['#D8C8A2', '#CDB98E', '#E2D5B5', '#BFA77C']) })
            }
          }
          continue
        }
        if (r < 0.17 && k !== WY_ROW) {
          let yy = yb
          const n = 3 + Math.floor(rnd() * 4), lw = 0.7 + rnd() * 0.35
          for (let i = 0; i < n; i++) {
            const th = 0.08 + rnd() * 0.06, d = 0.55 + rnd() * 0.2, off = (rnd() - 0.5) * 0.08
            books.push({ x: x + lw / 2 + off, y: yy + th / 2, z: BACK + d / 2, w: lw, h: th - 0.004, d, c: pick(leather) })
            yy += th
          }
          x += lw + 0.05
        }
        while (x < bx1 - 0.08) {
          const w = 0.075 + rnd() * 0.15
          if (rnd() < 0.03) { x += w; continue }
          const h = avail * (0.6 + rnd() * 0.36), d = 0.56 + rnd() * 0.24
          const bk: Book = { x: x + w / 2, y: yb + h / 2, z: BACK + d / 2, w: w - 0.008, h, d, c: pick(leather) }
          books.push(bk); shelfBooks[k].push(bk)
          if (rnd() < 0.68) {
            const g = pick(['#B8893A', '#C9A15A', '#8E6A2E'])
            for (const f of [0.3, -0.3]) bands.push({ x: bk.x, y: bk.y + h * f, z: BACK + d + 0.004, w: bk.w * 1.01, c: g })
            if (rnd() < 0.4) bands.push({ x: bk.x, y: bk.y + h * 0.18, z: BACK + d + 0.004, w: bk.w * 1.01, c: g })
          }
          x += w
        }
      }
    }
    const bookMesh = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.72 }), books.length)
    books.forEach((bk, i) => {
      dummy.position.set(bk.x, bk.y, bk.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(bk.w, bk.h, bk.d); dummy.updateMatrix()
      bookMesh.setMatrixAt(i, dummy.matrix)
      bookMesh.setColorAt(i, col(bk.c).multiplyScalar(0.85 + rnd() * 0.3))
    })
    bookMesh.castShadow = true; bookMesh.receiveShadow = true; scene.add(bookMesh)

    const bandMesh = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.7 }), bands.length)
    bands.forEach((bd, i) => {
      dummy.position.set(bd.x, bd.y, bd.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(bd.w, 0.024, 0.008); dummy.updateMatrix()
      bandMesh.setMatrixAt(i, dummy.matrix); bandMesh.setColorAt(i, col(bd.c))
    })
    bandMesh.receiveShadow = true; scene.add(bandMesh)

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 18)
    const disc = new THREE.CircleGeometry(1, 18)
    const scrollMesh = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ roughness: 0.9 }), scrolls.length)
    const discA = new THREE.InstancedMesh(disc, new THREE.MeshStandardMaterial({ color: col('#8A7450'), roughness: 1 }), scrolls.length)
    const discB = new THREE.InstancedMesh(disc, new THREE.MeshStandardMaterial({ color: col('#2E2216'), roughness: 1 }), scrolls.length)
    scrolls.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(Math.PI / 2, 0, 0); dummy.scale.set(s.r, s.len, s.r); dummy.updateMatrix()
      scrollMesh.setMatrixAt(i, dummy.matrix); scrollMesh.setColorAt(i, col(s.c))
      dummy.rotation.set(0, 0, 0)
      dummy.position.set(s.x + s.r * 0.06, s.y, s.z + s.len / 2 + 0.002); dummy.scale.set(s.r * 0.62, s.r * 0.62, 1); dummy.updateMatrix(); discA.setMatrixAt(i, dummy.matrix)
      dummy.position.set(s.x + s.r * 0.1, s.y + s.r * 0.04, s.z + s.len / 2 + 0.004); dummy.scale.set(s.r * 0.22, s.r * 0.22, 1); dummy.updateMatrix(); discB.setMatrixAt(i, dummy.matrix)
    })
    scrollMesh.castShadow = true; scrollMesh.receiveShadow = true
    scene.add(scrollMesh, discA, discB)

    // ladder
    const ladder = new THREE.Group(); scene.add(ladder)
    const ladderMat = new THREE.MeshStandardMaterial({ color: col('#6A4527'), roughness: 0.7 })
    const lb = new THREE.Vector3(0, 0, 1.55), lt = new THREE.Vector3(0, 9.6, 0.12)
    const railLen = lb.distanceTo(lt), tilt = Math.atan2(lb.z - lt.z, lt.y - lb.y)
    for (const dx of [-0.34, 0.34]) {
      const m = new THREE.Mesh(unit, ladderMat)
      m.scale.set(0.07, railLen, 0.1); m.position.set(dx, (lb.y + lt.y) / 2, (lb.z + lt.z) / 2); m.rotation.x = tilt
      m.castShadow = true; m.receiveShadow = true; ladder.add(m)
    }
    for (let y = 0.4; y < 9.4; y += 0.42) {
      const k = y / 9.6, m = new THREE.Mesh(cyl, ladderMat)
      m.scale.set(0.028, 0.68, 0.028); m.rotation.z = Math.PI / 2; m.position.set(0, y, lb.z + (lt.z - lb.z) * k); m.castShadow = true; ladder.add(m)
    }
    ladder.position.x = 3.15

    // lantern
    this.pivot = new THREE.Group(); this.pivot.position.set(1.0, 15, 1.75); scene.add(this.pivot)
    const lantern = new THREE.Group(); lantern.position.y = -8.1; lantern.scale.setScalar(1.5); this.pivot.add(lantern)
    const brass = new THREE.MeshStandardMaterial({ color: col('#9A7438'), roughness: 0.35, metalness: 0.8 })
    const chain = new THREE.Mesh(cyl, brass); chain.scale.set(0.012, 5.4, 0.012); chain.position.y = 2.85; lantern.add(chain)
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = new THREE.Mesh(unit, brass); m.scale.set(0.022, 0.34, 0.022); m.position.set(px * 0.1, 0, pz * 0.1); lantern.add(m)
    }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.14, 4), brass); cap.position.y = 0.24; cap.rotation.y = Math.PI / 4; lantern.add(cap)
    const base = new THREE.Mesh(unit, brass); base.scale.set(0.25, 0.03, 0.25); base.position.y = -0.18; lantern.add(base)
    this.glassMat = new THREE.MeshStandardMaterial({ color: col('#FFD9A0'), emissive: col('#FFB24D'), emissiveIntensity: 2.6, roughness: 0.2 })
    const glass = new THREE.Mesh(unit, this.glassMat); glass.scale.set(0.17, 0.3, 0.17); lantern.add(glass)
    this.lampLight = new THREE.PointLight(col('#FFC27A'), LIGHT.lampNight, 16, 2); lantern.add(this.lampLight)
    this.spot = new THREE.SpotLight(col('#FFB867'), LIGHT.spotNight, 20, 1.15, 0.85, 2)
    this.spot.castShadow = true; this.spot.shadow.mapSize.set(1024, 1024); this.spot.shadow.bias = -0.0006
    this.spot.shadow.camera.near = 0.3; this.spot.shadow.camera.far = 20
    lantern.add(this.spot); scene.add(this.spot.target); this.spot.target.position.set(1.2, 5.6, -0.6)

    // daylight
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1); scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(col('#FFF0D6'), LIGHT.sunDay)
    this.sun.position.set(-7, 13, 9); this.sun.target.position.set(1.5, 5, -0.5)
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0005
    Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 40 })
    scene.add(this.sun, this.sun.target)
    const shaftTex = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256
      const g = c.getContext('2d')!
      const h = g.createLinearGradient(0, 0, 64, 0)
      h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.5, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = h; g.fillRect(0, 0, 64, 256)
      g.globalCompositeOperation = 'destination-in'
      const v = g.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = v; g.fillRect(0, 0, 64, 256)
      return new THREE.CanvasTexture(c)
    })()
    this.shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: col('#FFE6B5'), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 24), this.shaftMat)
    shaft.position.set(-0.5, 10, 1.1); shaft.rotation.z = -0.55; scene.add(shaft)

    // dust / fireflies
    const DUST = 420
    this.dustPos = new Float32Array(DUST * 3); this.dustSeed = new Float32Array(DUST)
    for (let i = 0; i < DUST; i++) {
      this.dustPos[i * 3] = -3 + rnd() * 9; this.dustPos[i * 3 + 1] = 1 + rnd() * 11; this.dustPos[i * 3 + 2] = 0.2 + rnd() * 2.6; this.dustSeed[i] = rnd() * 100
    }
    this.dustGeo = new THREE.BufferGeometry(); this.dustGeo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3))
    const dotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64
      const g = c.getContext('2d')!
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = r; g.fillRect(0, 0, 64, 64)
      return new THREE.CanvasTexture(c)
    })()
    this.dustMat = new THREE.PointsMaterial({ map: dotTex, size: 0.11, color: col('#FFC983'), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    scene.add(new THREE.Points(this.dustGeo, this.dustMat))

    this.buildWyrm({ unit, dummy, disc, shelfBooks: shelfBooks[WY_ROW], WY: WY_ROW * SH + 0.07 + 0.55, BACK, halfWidth: (BW * BAYS) / 2 })
  }

  // ---------------------------------------------------------------- the paper wyrm
  // Body = stacked vellum page-blocks with gilt edges; head = a rolled page with scroll-curl horns;
  // tail = a silk bookmark ribbon. It weaves in and out of the spines on one shelf.
  private buildWyrm(ctx: { unit: THREE.BoxGeometry; dummy: THREE.Object3D; disc: THREE.CircleGeometry; shelfBooks: Book[]; WY: number; BACK: number; halfWidth: number }) {
    const { scene } = this
    const { unit, dummy, disc, shelfBooks, WY, BACK, halfWidth } = ctx
    const SEG = 30, K = 1.45, LEN = 3.0, RIB = 14

    const vellum = new THREE.MeshStandardMaterial({ color: col('#CDB78C'), roughness: 0.7, emissive: col('#3A2A18'), emissiveIntensity: 0.12 })
    const vellumDark = new THREE.MeshStandardMaterial({ color: col('#A88A58'), roughness: 0.75, emissive: col('#2A1E10'), emissiveIntensity: 0.1 })
    const gilt = new THREE.MeshStandardMaterial({ color: col('#C99A48'), roughness: 0.3, metalness: 0.75 })
    const pageMesh = new THREE.InstancedMesh(unit, vellum, SEG)
    const giltMesh = new THREE.InstancedMesh(unit, gilt, SEG)
    const finMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 3), vellumDark, SEG)
    pageMesh.castShadow = true; finMesh.castShadow = true
    for (let i = 0; i < SEG; i++) pageMesh.setColorAt(i, col(i % 2 ? '#D6C298' : '#BFA678'))
    scene.add(pageMesh, giltMesh, finMesh)

    const head = new THREE.Group(); scene.add(head)
    const skull = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.34, 24), vellum)
    skull.rotation.z = Math.PI / 2; skull.castShadow = true; head.add(skull)
    const rollEnd = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshStandardMaterial({ color: col('#B89E70'), roughness: 0.9 }))
    rollEnd.position.x = -0.171; rollEnd.rotation.y = -Math.PI / 2; head.add(rollEnd)
    ;[0.11, 0.06].forEach((r, i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.012, r, 24), new THREE.MeshBasicMaterial({ color: col(i ? '#5A4128' : '#7A5C38') }))
      ring.position.x = -0.173; ring.rotation.y = -Math.PI / 2; head.add(ring)
    })
    const giltBand = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.035, 24), gilt)
    giltBand.rotation.z = Math.PI / 2; giltBand.position.x = -0.12; head.add(giltBand)
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.22, 20), vellum)
    snout.rotation.z = -Math.PI / 2; snout.position.set(0.26, -0.04, 0); snout.scale.set(1, 1, 0.92); head.add(snout)
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), vellum)
    nose.position.set(0.37, -0.04, 0); nose.scale.set(0.55, 1, 0.92); head.add(nose)
    const jaw = new THREE.Mesh(unit, gilt); jaw.scale.set(0.26, 0.012, 0.2); jaw.position.set(0.28, -0.1, 0); head.add(jaw)
    const curl = new THREE.TorusGeometry(0.075, 0.022, 10, 24, Math.PI * 1.45)
    for (const z of [0.09, -0.09]) {
      const h = new THREE.Mesh(curl, vellumDark); h.position.set(-0.05, 0.2, z); h.rotation.set(0, 0, 0.6); h.castShadow = true; head.add(h)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), gilt)
      tip.position.set(-0.05 + Math.cos(0.6 + Math.PI * 1.45) * 0.075, 0.2 + Math.sin(0.6 + Math.PI * 1.45) * 0.075, z); head.add(tip)
    }
    this.eyeMat = new THREE.MeshStandardMaterial({ color: col('#FFD08A'), emissive: col('#FFA235'), emissiveIntensity: 5 })
    const eyeGroup = new THREE.Group(); eyeGroup.position.set(0.1, 0.06, 0.155); head.add(eyeGroup)
    eyeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), this.eyeMat))
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshBasicMaterial({ color: col('#1A0E06') }))
    pupil.position.set(0.012, 0, 0.038); pupil.scale.set(0.55, 1.2, 0.5); eyeGroup.add(pupil)
    eyeGroup.add(new THREE.PointLight(col('#FFA235'), LIGHT.eye, 1.6, 2))

    const ribbonMesh = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ color: col('#8E2A2A'), roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }), RIB)
    ribbonMesh.castShadow = true; scene.add(ribbonMesh)

    // burrow holes where the body crosses the spine plane
    const frontAt = (x: number) => {
      for (const b of shelfBooks) if (Math.abs(x - b.x) <= b.w / 2) return b.z + b.d / 2
      return BACK + 0.6
    }
    const holes: Array<{ x: number; z: number }> = []
    for (let n = -12; n <= 12; n++) { const x = (n * Math.PI) / K; if (Math.abs(x) < halfWidth) holes.push({ x, z: frontAt(x) + 0.003 }) }
    const holeDark = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: col('#0A0604') }), holes.length)
    const holeRim = new THREE.InstancedMesh(new THREE.RingGeometry(0.85, 1.25, 20), new THREE.MeshStandardMaterial({ color: col('#5A4128'), roughness: 1 }), holes.length)
    holes.forEach((h, i) => {
      dummy.rotation.set(0, 0, 0); dummy.position.set(h.x, WY, h.z); dummy.scale.set(0.15, 0.18, 1); dummy.updateMatrix(); holeDark.setMatrixAt(i, dummy.matrix)
      dummy.position.z = h.z - 0.001; dummy.updateMatrix(); holeRim.setMatrixAt(i, dummy.matrix)
    })
    scene.add(holeRim, holeDark)

    const spine: number[][] = []
    const bodyAt = (x: number, s: number, t: number) => {
      const out = s < 0.12 ? 1 : smooth(-0.1, 0.45, Math.sin(x * K))
      const z = -0.42 + 0.62 * out
      const y = WY + 0.06 * Math.sin(x * 2.6 + t * 2.0) + (s < 0.12 ? 0.1 * (1 - s / 0.12) : 0)
      return [x, y, z]
    }

    this.poseWyrm = (t: number) => {
      const xh = -0.4 + ((t * 0.26) % 9.6)
      spine.length = 0
      for (let i = 0; i <= SEG; i++) { const s = i / SEG; spine.push(bodyAt(xh - s * LEN, s, t)) }
      for (let i = 0; i < SEG; i++) {
        const s = i / (SEG - 1), a = spine[i], b = spine[i + 1]
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]
        const r = 0.17 * (0.32 + 0.68 * (1 - smooth(0.45, 1, s)))
        const ry = -Math.atan2(dz, dx), rz = Math.atan2(dy, Math.hypot(dx, dz))
        const flex = 1 + 0.06 * Math.sin(t * 3.2 - i * 0.7)
        dummy.position.set(mx, my, mz); dummy.rotation.set(0, ry, rz); dummy.scale.set(Math.hypot(dx, dy, dz) * 1.06, r * 2 * flex, r * 1.85); dummy.updateMatrix(); pageMesh.setMatrixAt(i, dummy.matrix)
        dummy.scale.set(0.022, r * 2.06 * flex, r * 1.92); dummy.position.set(b[0], b[1], b[2]); dummy.updateMatrix(); giltMesh.setMatrixAt(i, dummy.matrix)
        const fin = i % 2 === 0 && s > 0.06 && s < 0.82 ? r : 0.0001
        dummy.position.set(mx, my + r * flex * 1.05, mz); dummy.rotation.set(0, ry, rz - 0.35); dummy.scale.set(fin * 0.45, fin * 0.9, fin * 0.08); dummy.updateMatrix(); finMesh.setMatrixAt(i, dummy.matrix)
      }
      pageMesh.instanceMatrix.needsUpdate = true; giltMesh.instanceMatrix.needsUpdate = true; finMesh.instanceMatrix.needsUpdate = true

      const tail = spine[SEG]
      for (let j = 0; j < RIB; j++) {
        const u = j / RIB, x = tail[0] - 0.06 - u * 0.9
        const p = bodyAt(x, 1, t), y = p[1] - 0.06 - u * 0.12 + Math.sin(t * 4.2 - u * 7) * 0.05 * u
        dummy.position.set(x, y, p[2] + 0.02); dummy.rotation.set(0.3 * Math.sin(t * 3 - u * 5), 0, -0.15 + 0.4 * Math.cos(t * 4.2 - u * 7) * u)
        dummy.scale.set(0.075, j === RIB - 1 ? 0.03 : 0.075, 0.006); dummy.updateMatrix(); ribbonMesh.setMatrixAt(j, dummy.matrix)
      }
      ribbonMesh.instanceMatrix.needsUpdate = true

      const h = spine[0]
      head.position.set(h[0] + 0.14, h[1] + 0.1, h[2] + 0.04)
      const cyc = t % 8.5
      const glance = smooth(5.2, 5.8, cyc) * (1 - smooth(7.2, 7.8, cyc))
      head.rotation.set(0, -0.2 - glance * 0.85, 0.1 * Math.sin(t * 1.6) + glance * 0.12)
      const blink = t % 4.4 < 0.14 || Math.abs(cyc - 6.4) < 0.07
      eyeGroup.scale.y = blink ? 0.12 : 1
    }
  }

  // ---------------------------------------------------------------- theme
  private applyTheme() {
    const dark = this.dark
    this.scene.background = dark ? col('#0A0705') : col('#D8CBB1')
    this.hemi.color = dark ? col('#5E5470') : col('#F1EADC')
    this.hemi.groundColor = dark ? col('#0B0604') : col('#6A5038')
    this.hemi.intensity = dark ? LIGHT.hemiNight : LIGHT.hemiDay
    this.sun.intensity = dark ? 0 : LIGHT.sunDay
    this.sun.castShadow = !dark
    this.lampLight.intensity = dark ? LIGHT.lampNight : 0
    this.spot.intensity = dark ? LIGHT.spotNight : 0
    this.spot.castShadow = dark
    this.glassMat.emissiveIntensity = dark ? 2.6 : 0.15
    this.shaftMat.opacity = dark ? 0 : 0.32
    this.dustMat.color = dark ? col('#FFC27A') : col('#FFF3D6')
    this.dustMat.opacity = dark ? 0.85 : 0.7
    this.eyeMat.emissiveIntensity = dark ? 5 : 3.2
    this.post.uniforms.uDark.value = dark ? 1 : 0
    this.needsFrame = true
    this.kick()
  }

  // ---------------------------------------------------------------- sizing & events
  resize = () => {
    const { host, plate, renderer, camera } = this
    const W = host.clientWidth, H = host.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false)
    this.rt.setSize(Math.max(2, Math.round(W * dpr * 0.75)), Math.max(2, Math.round(H * dpr * 0.75)))
    ;(this.post.uniforms.uRes.value as THREE.Vector2).set(W * dpr, H * dpr)
    camera.aspect = W / H
    const pf = plate.getBoundingClientRect(), hr = host.getBoundingClientRect()
    const cx = pf.left + pf.width / 2 - hr.left, cy = pf.top + pf.height / 2 - hr.top
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H)
    // fit the lens to the plate, not the whole canvas, so small screens don't look zoomed in
    const ph = Math.max(120, pf.height), pw = Math.max(120, pf.width)
    const half = Math.atan(Math.tan((14 * Math.PI) / 180) * Math.max(1, 1.15 / (pw / ph)))
    camera.fov = Math.min(150, (2 * Math.atan((Math.tan(half) * H) / ph) * 180) / Math.PI)
    this.dustMat.size = 0.11 * Math.min(1, (ph / H) * 1.3)
    camera.updateProjectionMatrix()
    this.needsFrame = true
    this.kick()
  }

  private bindEvents() {
    const { host } = this
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      this.mouse.tx = ((e.clientX - r.left) / r.width) * 2 - 1
      this.mouse.ty = ((e.clientY - r.top) / r.height) * 2 - 1
    }
    const onLeave = () => { this.mouse.tx = 0; this.mouse.ty = 0 }
    const onVis = () => { this.last = performance.now(); this.kick() }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', this.resize)
    const ro = new ResizeObserver(() => this.resize()); ro.observe(host); ro.observe(this.plate)
    const io = new IntersectionObserver((es) => {
      this.visible = es[0].isIntersecting
      this.last = performance.now()
      this.kick()
    })
    io.observe(host)
    this.disposers.push(
      () => host.removeEventListener('pointermove', onMove),
      () => host.removeEventListener('pointerleave', onLeave),
      () => document.removeEventListener('visibilitychange', onVis),
      () => window.removeEventListener('resize', this.resize),
      () => ro.disconnect(),
      () => io.disconnect(),
    )
  }

  // ---------------------------------------------------------------- loop
  /** Whether a frame is worth drawing: on screen, tab visible, and either playing or stale. */
  private get shouldRender() {
    return this.visible && !document.hidden && (this.running || this.needsFrame)
  }

  /** Start the loop if it is stopped and there is something to draw. The loop stops itself
   *  (no rAF pending at all) when the canvas is off-screen, the tab is hidden, or it is paused. */
  private kick() {
    if (this.raf || this.disposed || !this.shouldRender) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (this.disposed || !this.shouldRender) return
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now
    if (this.running) this.t += dt
    const { t, mouse, camera } = this
    mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04

    const camY = 6.35 + 1.25 * Math.sin(t * 0.055) - mouse.y * 0.3
    const camX = 1.7 + mouse.x * 0.45
    camera.position.set(camX, camY + 0.15, 8.6)
    camera.lookAt(camX - 0.1, camY - 0.1, 0)

    this.pivot.rotation.z = 0.035 * Math.sin(t * 0.8); this.pivot.rotation.x = 0.02 * Math.sin(t * 0.63)
    if (this.dark) {
      const fl = 0.93 + 0.07 * Math.sin(t * 11.0) * Math.sin(t * 6.7)
      this.lampLight.intensity = LIGHT.lampNight * fl; this.spot.intensity = LIGHT.spotNight * fl
    }
    const { dustPos, dustSeed } = this
    for (let i = 0; i < dustSeed.length; i++) {
      const s = dustSeed[i]
      dustPos[i * 3] += Math.sin(t * 0.3 + s) * 0.0015
      dustPos[i * 3 + 1] += 0.0016 + Math.sin(t * 0.5 + s * 2.0) * 0.0012
      if (dustPos[i * 3 + 1] > 12) dustPos[i * 3 + 1] = 1
    }
    this.dustGeo.attributes.position.needsUpdate = true
    this.poseWyrm(t)
    this.post.uniforms.uTime.value = t

    this.renderer.setRenderTarget(this.rt); this.renderer.render(this.scene, camera)
    this.renderer.setRenderTarget(null); this.renderer.render(this.postScene, this.postCam)
    this.needsFrame = false
    if (this.running) this.raf = requestAnimationFrame(this.frame)
  }
}
