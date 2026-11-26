import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { StaticBatcher, bakeGeometry, mergeBaked } from './geo.js'
import { GROUP } from './constants.js'

const DEG = Math.PI / 180
const V3 = THREE.Vector3
const UP = new V3(0, 1, 0)

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

const STYLES = {
  grass: { top: '#8bd36a', side: '#a87447', bottom: '#6f4a2d', thick: 1.2 },
  stone: { top: '#efe7d6', side: '#c4b9a3', bottom: '#958b78', thick: 0.9 },
  wood: { top: '#d0965b', side: '#a06a3c', bottom: '#7c512d', thick: 0.3 },
}
const DIRT = { top: '#9b6b42', side: '#8a5c38', bottom: '#5e3f27' }
const ROCK = { top: '#a29db0', side: '#8c879b', bottom: '#6f6a7e' }
const RAIL = { all: '#6b4426' }
const STRIPE = { all: '#ffb21e' }
const HAZARD = { all: '#ff4d5e' }

export const fwdOf = (yaw, out = new V3()) => out.set(Math.sin(yaw), 0, Math.cos(yaw))
export const rightOf = (yaw, out = new V3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw))
const leftOf = (yaw, out = new V3()) => out.set(Math.cos(yaw), 0, -Math.sin(yaw))

const _m = new THREE.Matrix4()
const _s = new V3()
const _p = new V3()
const _q = new THREE.Quaternion()

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export class Course {
  constructor(scene, world, groundMaterial, crateMaterial) {
    this.scene = scene
    this.world = world
    this.groundMat = groundMaterial
    this.crateMat = crateMaterial
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    this.batch = new StaticBatcher()
    this.rand = rng(1337)

    this.pos = new V3(0, 40, 0)
    this.yaw = 0
    this.piece = 0
    this.path = [{ x: 0, y: 40, z: 0, s: 0 }]
    this.totalLength = 0
    this.minY = Infinity
    this.maxY = -Infinity
    this.checkpoints = []
    this.moving = []
    this.crates = []
    this.lastPiece = null
    // sprite foliage placements, built into billboards in main.js
    this.sprites = { tree1: [], tree2: [], bush1: [] }

    this.postMat = new THREE.MeshLambertMaterial({ color: '#f6f2ea' })
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true)
  }

  get chunk() {
    return Math.floor(this.piece / 5)
  }

  track(p) {
    this.minY = Math.min(this.minY, p.y)
    this.maxY = Math.max(this.maxY, p.y)
  }

  addPathTo(target) {
    const last = this.path[this.path.length - 1]
    const dx = target.x - last.x
    const dy = target.y - last.y
    const dz = target.z - last.z
    const d = Math.hypot(dx, dy, dz)
    const n = Math.max(1, Math.ceil(d / 2))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      this.path.push({ x: last.x + dx * t, y: last.y + dy * t, z: last.z + dz * t, s: last.s + d * t })
    }
    this.totalLength = this.path[this.path.length - 1].s
    this.track(target)
  }

  frame(origin, quat) {
    const o = origin.clone()
    const q = quat.clone()
    const self = this
    return {
      origin: o,
      quat: q,
      point(x, y, z, out = new V3()) {
        return out.set(x, y, z).applyQuaternion(q).add(o)
      },
      box(x, y, z, sx, sy, sz, colors, jitter) {
        self.addGeo(UNIT_BOX, this.point(x, y, z, _p), q, sx, sy, sz, colors, jitter)
      },
    }
  }

  addGeo(geo, pos, quat, sx, sy, sz, colors, jitter, key = this.chunk) {
    _m.compose(pos, quat, _s.set(sx, sy, sz))
    this.batch.add(geo, _m, colors, key, jitter)
  }

  staticBody(shape, pos, quat) {
    const b = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: this.groundMat,
      collisionFilterGroup: GROUP.STATIC,
      collisionFilterMask: GROUP.BIKE | GROUP.CRATE,
    })
    b.addShape(shape)
    b.position.set(pos.x, pos.y, pos.z)
    if (quat) b.quaternion.set(quat.x, quat.y, quat.z, quat.w)
    this.world.addBody(b)
    return b
  }

  staticBox(pos, quat, hx, hy, hz) {
    return this.staticBody(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), pos, quat)
  }

  /** A straight walkable slab whose top surface starts at the cursor. */
  plank(len, o = {}) {
    const style = o.style || 'stone'
    const st = STYLES[style]
    const width = o.width ?? 6
    const pitch = (o.pitch ?? 0) * DEG
    const thick = st.thick
    const dir = new V3(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch))
    const left = leftOf(this.yaw)
    const nrm = new V3().crossVectors(dir, left)
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, nrm, dir))
    const ext = len + (o.extend ?? 0.25)
    const F = this.frame(this.pos, quat)

    this.staticBox(F.point(0, -thick / 2, ext / 2), quat, width / 2, thick / 2, ext / 2)

    if (style === 'wood') {
      const n = Math.max(1, Math.round(ext / 0.6))
      const pl = ext / n
      for (let i = 0; i < n; i++) F.box(0, -0.08, (i + 0.5) * pl, width, 0.16, pl - 0.07, st, 0.12)
      for (const s of [-1, 1]) F.box(s * (width / 2 - 0.25), -0.3, ext / 2, 0.3, 0.3, ext, RAIL)
      if (o.rails) {
        const posts = Math.max(2, Math.round(ext / 2.6) + 1)
        for (const s of [-1, 1]) {
          const x = s * (width / 2 - 0.08)
          for (let i = 0; i < posts; i++) F.box(x, 0.45, (i / (posts - 1)) * ext, 0.12, 0.9, 0.12, RAIL)
          F.box(x, 0.9, ext / 2, 0.1, 0.1, ext, { all: '#8a5a33' })
          this.staticBox(F.point(x, 0.45, ext / 2), quat, 0.06, 0.45, ext / 2)
        }
      }
    } else if (style === 'grass') {
      F.box(0, -thick / 2, ext / 2, width, thick, ext, st)
      F.box(0, -thick - 0.8, ext / 2, width * 0.72, 1.6, ext * 0.94, DIRT)
      F.box(0, -thick - 2.1, ext / 2, width * 0.4, 1.2, ext * 0.8, ROCK)
    } else {
      F.box(0, -thick / 2, ext / 2, width, thick, ext, st)
      F.box(0, -thick - 0.25, ext / 2, width * 0.8, 0.5, ext * 0.97, { all: '#a69c88' })
      for (const s of [-1, 1]) F.box(s * (width / 2 - 0.3), 0.015, ext / 2, 0.24, 0.03, ext, STRIPE)
    }

    if (o.ramp) {
      const count = Math.max(2, Math.floor(len / 1.6))
      for (let i = 0; i < count; i++) {
        const z = 0.8 + i * 1.6
        F.box(0.45, 0.02, z, 1.1, 0.04, 0.35, { all: '#ff7a1a' })
        F.box(-0.45, 0.02, z, 1.1, 0.04, 0.35, { all: '#ff7a1a' })
      }
    }

    if (o.pillars) for (const [x, z] of o.pillars) this.pillar(F.point(x, 0, z), 4.2)
    if (o.crates) for (const [x, z, h] of o.crates) this.crateStack(F.point(x, 0, z), h ?? 1)

    const end = this.pos.clone().addScaledVector(dir, len)
    this.lastPiece = { F, len, width }
    this.addPathTo(end)
    this.pos.copy(end)
    this.piece++
    return { F, quat, dir, width, len }
  }

  /** A curved section built from short rotated planks. Positive angle turns right. */
  curve(angleDeg, radius, o = {}) {
    const total = angleDeg * DEG
    const segs = o.segs ?? Math.max(3, Math.ceil(Math.abs(angleDeg) / 9))
    const step = total / segs
    const segLen = radius * Math.abs(step)
    const width = o.width ?? 6
    for (let i = 0; i < segs; i++) {
      this.yaw -= step / 2
      this.plank(segLen, { ...o, extend: 0.25 + width * Math.tan(Math.abs(step) / 2) })
      this.yaw -= step / 2
    }
  }

  gap(len, dy = 0) {
    if (this.lastPiece) {
      const { F, len: l, width } = this.lastPiece
      F.box(0, 0.02, l - 0.35, width - 0.2, 0.04, 0.5, HAZARD)
      F.box(0, 0.02, l - 1.25, width - 0.2, 0.04, 0.3, HAZARD)
    }
    const end = this.pos.clone().addScaledVector(fwdOf(this.yaw), len)
    end.y += dy
    this.addPathTo(end)
    this.pos.copy(end)
    this.lastPiece = null
  }

  /** A round floating island; can turn the course and host checkpoints. */
  island(radius, turnDeg = 0, o = {}) {
    const entryYaw = this.yaw
    const center = this.pos.clone().addScaledVector(fwdOf(entryYaw), radius * 0.85)
    const key = this.chunk

    this.staticBody(new CANNON.Cylinder(radius, radius, 2, 16), _p.set(center.x, center.y - 1, center.z))
    const segs = Math.max(12, Math.round(radius * 1.6))
    _q.identity()
    this.addGeo(
      new THREE.CylinderGeometry(radius, radius * 0.96, 1.4, segs),
      _p.set(center.x, center.y - 0.7, center.z),
      _q,
      1,
      1,
      1,
      STYLES.grass,
      0.06,
      key,
    )
    const flip = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), Math.PI)
    const coneH = radius * 1.35
    this.addGeo(new THREE.ConeGeometry(radius * 0.93, coneH, 9), _p.set(center.x, center.y - 1.4 - coneH / 2, center.z), flip, 1, 1, 1, DIRT, 0.1, key)
    const coneH2 = radius * 0.9
    this.addGeo(
      new THREE.ConeGeometry(radius * 0.5, coneH2, 7),
      _p.set(center.x + radius * 0.25, center.y - 1.4 - coneH * 0.55 - coneH2 / 2, center.z - radius * 0.2),
      flip,
      1,
      1,
      1,
      ROCK,
      0.1,
      key,
    )

    this.addPathTo(center)
    this.yaw -= turnDeg * DEG
    const exitYaw = this.yaw
    const exit = center.clone().addScaledVector(fwdOf(exitYaw), radius * 0.85)
    this.addPathTo(exit)

    const gateYaw = entryYaw + (exitYaw - entryYaw) / 2
    const hasGate = o.checkpoint || o.finish
    const gateWidth = Math.min(radius * 1.15, 9)
    const avoid = [entryYaw + Math.PI, exitYaw]
    const avoidSoft = hasGate ? [gateYaw + Math.PI / 2, gateYaw - Math.PI / 2] : []
    const spots = []
    const start = this.rand() * Math.PI * 2
    for (let i = 0; i < 24; i++) {
      const a = start + (i / 24) * Math.PI * 2
      if (avoid.some((b) => angleDiff(a, b) < 0.85)) continue
      if (avoidSoft.some((b) => angleDiff(a, b) < 0.45)) continue
      if (spots.some((b) => angleDiff(a, b) < 0.7)) continue
      spots.push(a)
    }
    const trees = o.trees ?? 2
    let used = 0
    for (const a of spots) {
      if (used >= trees) break
      this.tree(new V3(center.x + Math.sin(a) * radius * 0.74, center.y, center.z + Math.cos(a) * radius * 0.74), 0.85 + this.rand() * 0.4, center)
      used++
    }
    if (o.crates) {
      const a = spots[used] ?? spots[0]
      if (a !== undefined) this.crateStack(new V3(center.x + Math.sin(a) * radius * 0.5, center.y, center.z + Math.cos(a) * radius * 0.5), o.crates)
    }

    if (hasGate) this.addGate(center, gateYaw, gateWidth, o.finish ? 'finish' : 'checkpoint', exitYaw, radius)

    this.pos.copy(exit)
    this.lastPiece = null
    this.piece++
  }

  /** A kinematic platform sliding sideways across a hole in the path. */
  slider(len, o = {}) {
    const width = o.width ?? 7
    const amp = o.amp ?? 4.5
    const period = o.period ?? 4
    const phase = o.phase ?? 0
    const f = fwdOf(this.yaw)
    const clearance = 0.25
    const top = this.pos.clone().addScaledVector(f, clearance + len / 2)
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw)
    const base = top.clone()
    base.y -= 0.35

    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: this.groundMat,
      collisionFilterGroup: GROUP.STATIC,
      collisionFilterMask: GROUP.BIKE | GROUP.CRATE,
    })
    body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, 0.35, len / 2)))
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w)
    this.world.addBody(body)

    const parts = []
    const add = (x, y, z, sx, sy, sz, colors) => {
      _m.compose(_p.set(x, y, z), _q.identity(), _s.set(sx, sy, sz))
      parts.push(bakeGeometry(UNIT_BOX, _m, colors))
    }
    add(0, 0, 0, width, 0.7, len, { top: '#cfeaff', side: '#5b86c4', bottom: '#3d5f94' })
    for (const s of [-1, 1]) add(s * (width / 2 - 0.3), 0.37, 0, 0.24, 0.04, len, { all: '#38e8ff' })
    add(0, -0.55, 0, width * 0.55, 0.4, len * 0.55, { all: '#38e8ff' })
    add(0, -0.9, 0, width * 0.3, 0.3, len * 0.3, { all: '#5b86c4' })
    const mesh = new THREE.Mesh(mergeBaked(parts), this.material)
    mesh.quaternion.copy(quat)
    this.scene.add(mesh)

    this.moving.push({ body, mesh, base, axis: rightOf(this.yaw), amp, omega: (Math.PI * 2) / period, phase })

    const end = this.pos.clone().addScaledVector(f, len + clearance * 2)
    this.addPathTo(end)
    this.pos.copy(end)
    this.lastPiece = null
    this.piece++
  }

  tree(at, scale = 1, center = null) {
    // exactly one rand() call per tree keeps the course layout identical to before
    const r = this.rand()
    const kind = r < 0.5 ? 'tree1' : 'tree2'
    const h = (kind === 'tree1' ? 5.4 : 7.2) * scale
    // island disc, used to keep the soft ground shadow on the island
    const clip = center
      ? { gy: at.y, cx: center.x, cz: center.z, cr: Math.hypot(at.x - center.x, at.z - center.z) / 0.74 - 0.4 }
      : {}
    this.sprites[kind].push({ x: at.x, y: at.y - 0.05, z: at.z, h, ...clip })
    // a small flowering bush at the foot of some trees, nudged toward the island centre
    const k = (r * 7.31) % 1
    if (k > 0.4) {
      const bx = center ? at.x + (center.x - at.x) * 0.22 : at.x + 1.4
      const bz = center ? at.z + (center.z - at.z) * 0.22 : at.z
      const side = k > 0.7 ? 1 : -1
      this.sprites.bush1.push({ x: bx + side * 1.1, y: at.y - 0.05, z: bz + side * 0.6, h: 1.9 + k * 0.8, ...clip })
    }
    this.staticBox(_p.set(at.x, at.y + 1.5, at.z), null, 0.3 * scale, 1.5, 0.3 * scale)
  }

  pillar(base, h) {
    _q.setFromAxisAngle(UP, this.rand() * Math.PI)
    this.addGeo(new THREE.CylinderGeometry(0.9, 1.15, h, 7), _p.set(base.x, base.y + h / 2, base.z), _q, 1, 1, 1, { top: '#ffb21e', side: '#d2c8b4' }, 0.08)
    this.addGeo(new THREE.CylinderGeometry(1.2, 0.95, 0.5, 7), _p.set(base.x, base.y + h + 0.25, base.z), _q, 1, 1, 1, { all: '#ff7a1a' }, 0.05)
    this.staticBody(new CANNON.Cylinder(0.95, 1.15, h, 8), _p.set(base.x, base.y + h / 2, base.z))
  }

  crateStack(at, height = 1) {
    const yaw = this.rand() * Math.PI
    const f = fwdOf(yaw)
    const l = leftOf(yaw)
    const layers = height >= 3 ? [3, 2, 1] : height === 2 ? [2, 1] : [1]
    layers.forEach((count, row) => {
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * 0.84
        const p = at.clone().addScaledVector(l, off).addScaledVector(f, 0)
        p.y += 0.41 + row * 0.82
        this.crates.push({ home: p, yaw, body: null })
      }
    })
  }

  addGate(center, yaw, width, kind, respawnYaw, radius) {
    const g = new THREE.Group()
    g.position.copy(center)
    g.rotation.y = yaw
    const isFinish = kind === 'finish' || kind === 'start'

    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(UNIT_BOX, this.postMat)
      post.scale.set(0.45, 3.8, 0.45)
      post.position.set(s * (width / 2), 1.9, 0)
      g.add(post)
      const p = center.clone().addScaledVector(leftOf(yaw), s * (width / 2))
      p.y += 1.9
      this.staticBox(p, new THREE.Quaternion().setFromAxisAngle(UP, yaw), 0.22, 1.9, 0.22)
    }

    let bannerMat
    if (isFinish && typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = 256
      c.height = 32
      const ctx = c.getContext('2d')
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 2; y++) {
          ctx.fillStyle = (x + y) % 2 ? '#111111' : '#ffffff'
          ctx.fillRect(x * 16, y * 16, 16, 16)
        }
      }
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      bannerMat = new THREE.MeshBasicMaterial({ map: tex })
    } else {
      bannerMat = new THREE.MeshBasicMaterial({ color: '#ff8a1f' })
    }
    const banner = new THREE.Mesh(UNIT_BOX, bannerMat)
    banner.scale.set(width + 0.45, 0.8, 0.22)
    banner.position.set(0, 3.8, 0)
    g.add(banner)

    let beamMat = null
    if (kind !== 'start') {
      beamMat = new THREE.MeshBasicMaterial({
        color: kind === 'finish' ? '#fff3a0' : '#ffb347',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      })
      const beam = new THREE.Mesh(this.beamGeo, beamMat)
      beam.scale.set(1.2, 60, 1.2)
      beam.position.set(0, 34, 0)
      g.add(beam)
    }
    this.scene.add(g)

    if (kind !== 'start') {
      this.checkpoints.push({
        kind,
        center: center.clone(),
        spawn: new V3(center.x, center.y + 0.6, center.z),
        yaw: respawnYaw,
        radius,
        bannerMat,
        beamMat,
        reached: false,
      })
    }
  }

  build() {
    // Start
    const start = this.plank(36, { style: 'grass', width: 11, crates: [[3.4, 20, 3]] })
    this.startSpawn = start.F.point(0, 0.6, 5)
    this.startYaw = 0
    this.checkpoints.push({ kind: 'start', center: this.startSpawn.clone(), spawn: this.startSpawn.clone(), yaw: 0, radius: 0, reached: true })
    this.addGate(start.F.point(0, 0, 11), 0, 11.8, 'start', 0, 0)

    // Warm-up
    this.plank(30, { style: 'wood', width: 5, rails: true })
    this.curve(60, 26, { style: 'stone', width: 6.5 })
    this.plank(18, { style: 'stone', width: 6.5 })
    this.gap(4.5, -0.3)
    this.plank(22, { style: 'grass', width: 9 })
    this.island(11, -45, { checkpoint: true, trees: 3 })

    // Ramps
    this.plank(16, { style: 'stone', width: 6 })
    this.plank(8, { style: 'stone', width: 6, pitch: 15, ramp: true })
    this.gap(8, -2.6)
    this.plank(26, { style: 'grass', width: 10, pitch: -3 })
    this.curve(-90, 30, { style: 'stone', width: 6.5 })
    this.plank(30, { style: 'stone', width: 6.5, pitch: -10 })
    this.plank(10, { style: 'stone', width: 6.5 })
    this.plank(9, { style: 'stone', width: 6.5, pitch: 17, ramp: true })
    this.gap(10, -3.2)
    this.island(15, 30, { checkpoint: true, trees: 4, crates: 3 })

    // Narrow bridges
    this.plank(24, { style: 'wood', width: 3.4 })
    this.island(6.5, 50, { trees: 1 })
    this.plank(20, { style: 'wood', width: 3.4, pitch: 6 })
    this.island(6.5, -70, { trees: 1 })
    this.plank(26, { style: 'wood', width: 3.6, rails: true })
    this.island(11, 0, { checkpoint: true, trees: 4 })

    // Sliding platforms
    this.plank(10, { style: 'stone', width: 6 })
    this.slider(10, { width: 7, amp: 4.5, period: 4.2 })
    this.plank(8, { style: 'stone', width: 6 })
    this.slider(11, { width: 7, amp: 5.5, period: 3.6, phase: 1.6 })
    this.plank(8, { style: 'stone', width: 6 })
    this.island(11, 90, { checkpoint: true, trees: 3 })

    // Stepping stones
    this.plank(14, { style: 'grass', width: 7 })
    this.gap(5, 0)
    this.plank(10, { style: 'grass', width: 7 })
    this.gap(5.5, 0.4)
    this.plank(10, { style: 'grass', width: 7 })
    this.gap(6, -1)
    this.plank(14, { style: 'grass', width: 8 })
    this.curve(45, 22, { style: 'stone', width: 7 })

    // Pillar slalom
    this.plank(46, {
      style: 'grass',
      width: 14,
      pillars: [
        [3.2, 9],
        [-3.4, 17],
        [3.6, 25],
        [-3.0, 33],
        [2.4, 41],
      ],
      crates: [[-5, 6, 2]],
    })
    this.island(12, -20, { checkpoint: true, trees: 2, crates: 2 })

    // Big drop jump
    this.plank(40, { style: 'stone', width: 8, pitch: -12 })
    this.plank(12, { style: 'stone', width: 8 })
    this.plank(10, { style: 'stone', width: 8, pitch: 19, ramp: true })
    this.gap(13, -6)
    this.plank(32, { style: 'grass', width: 13, pitch: -6 })
    this.island(14, -40, { checkpoint: true, trees: 4 })

    // Spiral climb
    this.curve(-180, 22, { style: 'stone', width: 6.5, pitch: 5, segs: 18 })
    this.plank(16, { style: 'stone', width: 6.5 })
    this.plank(8, { style: 'stone', width: 6.5, pitch: 15, ramp: true })
    this.gap(6.5, -1.5)
    this.island(10, 60, { checkpoint: true, trees: 3 })

    // Zigzag to the finish
    this.plank(14, { style: 'wood', width: 4.2 })
    this.curve(40, 13, { style: 'wood', width: 4.2 })
    this.curve(-80, 13, { style: 'wood', width: 4.2 })
    this.curve(40, 13, { style: 'wood', width: 4.2 })
    this.plank(30, { style: 'stone', width: 8 })
    this.island(16, 0, { finish: true, trees: 6 })
  }

  finalize() {
    this.staticMeshes = this.batch.build(this.material, this.scene)

    if (this.crates.length) {
      const geo = bakeGeometry(new THREE.BoxGeometry(0.8, 0.8, 0.8), null, { top: '#e8b566', side: '#cf9443', bottom: '#8f5f27' }, 0.08)
      this.crateMesh = new THREE.InstancedMesh(geo, this.material, this.crates.length)
      this.crateMesh.frustumCulled = false
      this.scene.add(this.crateMesh)
      for (const c of this.crates) {
        const b = new CANNON.Body({
          mass: 5,
          material: this.crateMat,
          shape: new CANNON.Box(new CANNON.Vec3(0.4, 0.4, 0.4)),
          collisionFilterGroup: GROUP.CRATE,
          collisionFilterMask: GROUP.STATIC | GROUP.BIKE | GROUP.CRATE,
          linearDamping: 0.05,
          angularDamping: 0.1,
        })
        b.sleepSpeedLimit = 0.3
        b.sleepTimeLimit = 0.4
        c.body = b
        this.world.addBody(b)
      }
    }
    this.reset()
  }

  reset() {
    for (const c of this.crates) {
      const b = c.body
      b.position.set(c.home.x, c.home.y, c.home.z)
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.yaw)
      b.velocity.set(0, 0, 0)
      b.angularVelocity.set(0, 0, 0)
      b.sleep()
      c.gone = false
    }
    for (let i = 1; i < this.checkpoints.length; i++) this.setReached(this.checkpoints[i], false)
    this.update(1 / 60, 0)
    for (const m of this.moving) m.body.position.set(m.target.x, m.target.y, m.target.z)
    this.sync()
  }

  setReached(cp, reached) {
    cp.reached = reached
    if (cp.kind === 'checkpoint') {
      cp.bannerMat.color.set(reached ? '#35e07a' : '#ff8a1f')
      cp.beamMat.color.set(reached ? '#7dffb0' : '#ffb347')
      cp.beamMat.opacity = reached ? 0.1 : 0.22
    }
  }

  /** Drives kinematic platforms by velocity so the physics solver carries the rider. */
  update(dt, t) {
    for (const m of this.moving) {
      const off = m.amp * Math.sin(m.omega * (t + dt) + m.phase)
      m.target = m.target || new V3()
      m.target.copy(m.base).addScaledVector(m.axis, off)
      const p = m.body.position
      m.body.velocity.set((m.target.x - p.x) / dt, (m.target.y - p.y) / dt, (m.target.z - p.z) / dt)
    }
  }

  sync() {
    for (const m of this.moving) m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z)
    if (this.crateMesh) {
      const fallY = this.minY - 40
      this.crates.forEach((c, i) => {
        const b = c.body
        if (!c.gone && b.position.y < fallY) {
          c.gone = true
          b.sleep()
          b.position.y = fallY - 100
        }
        _p.set(b.position.x, b.position.y, b.position.z)
        _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)
        _m.compose(_p, _q, _s.setScalar(c.gone ? 0 : 1))
        this.crateMesh.setMatrixAt(i, _m)
      })
      this.crateMesh.instanceMatrix.needsUpdate = true
    }
  }

  /** Finds the nearest path sample near a hint index and returns distance along the course. */
  progress(pos, hint) {
    const path = this.path
    let best = hint
    let bestD = Infinity
    const lo = Math.max(0, hint - 20)
    const hi = Math.min(path.length - 1, hint + 40)
    for (let i = lo; i <= hi; i++) {
      const p = path[i]
      const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 * 0.5 + (p.z - pos.z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  nearestIndex(pos) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < this.path.length; i++) {
      const p = this.path[i]
      const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }
}
