import * as THREE from 'three'
import { bakeGeometry, mergeBaked } from './geo.js'
import { BIKE } from './constants.js'
import { riderLook } from './riders.js'
import { makeHair, accentMaterial } from './riderParts.js'

const V3 = THREE.Vector3
const UP = new V3(0, 1, 0)
const CRANK_L = 0.17

const CYL = new THREE.CylinderGeometry(1, 1, 1, 7)
const SPHERE = new THREE.SphereGeometry(1, 10, 8)
const BOX = new THREE.BoxGeometry(1, 1, 1)

const _d = new V3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new V3()

function tubeMatrix(a, b, r) {
  _d.subVectors(b, a)
  const len = _d.length() || 0.0001
  _q.setFromUnitVectors(UP, _d.divideScalar(len))
  return _m.compose(new V3().addVectors(a, b).multiplyScalar(0.5), _q, _s.set(r, len, r))
}

function placeBetween(mesh, a, b, r) {
  _d.subVectors(b, a)
  const len = _d.length() || 0.0001
  mesh.position.addVectors(a, b).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, _d.divideScalar(len))
  mesh.scale.set(r, len, r)
}

const _dir = new V3()
const _bend = new V3()
function solveIK(root, target, l1, l2, pole, out) {
  _dir.subVectors(target, root)
  const dist = Math.min(Math.max(_dir.length(), 0.05), l1 + l2 - 0.002)
  _dir.normalize()
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)))
  _bend.copy(pole).addScaledVector(_dir, -pole.dot(_dir)).normalize()
  return out.copy(root).addScaledVector(_dir, Math.cos(a) * l1).addScaledVector(_bend, Math.sin(a) * l1)
}

const COLORS = {
  frame: '#ff3d57',
  silver: '#cfd6dd',
  dark: '#23252e',
  tire: '#1b1c22',
  jersey: '#ffb000',
  jerseyDark: '#e08f00',
  shorts: '#20232f',
  skin: '#e8a27c',
  helmet: '#ff3d57',
  shoe: '#f4f4f4',
}

function buildWheel(R, tire, spokes, rimColor, knobs) {
  const parts = []
  const torus = new THREE.TorusGeometry(R - tire, tire, 6, 24)
  torus.rotateY(Math.PI / 2)
  parts.push(bakeGeometry(torus, null, { all: COLORS.tire }, 0))
  if (knobs) {
    // knobby tread blocks for the mountain bike
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      _q.setFromAxisAngle(new V3(1, 0, 0), a)
      _m.compose(new V3(0, Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004)), _q, _s.set(tire * 2.1, 0.03, 0.05))
      parts.push(bakeGeometry(BOX, _m, { all: COLORS.tire }, 0))
    }
  }
  const rimR = R - tire * 2 - 0.006
  const rim = new THREE.TorusGeometry(rimR, 0.014, 4, 24)
  rim.rotateY(Math.PI / 2)
  parts.push(bakeGeometry(rim, null, { all: rimColor }, 0))
  for (let i = 0; i < spokes; i++) {
    _q.setFromAxisAngle(new V3(1, 0, 0), (i * Math.PI) / spokes)
    _m.compose(new V3(), _q, _s.set(spokes <= 3 ? 0.03 : 0.008, (rimR - 0.006) * 2, spokes <= 3 ? 0.02 : 0.008))
    parts.push(bakeGeometry(BOX, _m, { all: spokes <= 3 ? rimColor : COLORS.silver }, 0))
  }
  const hub = new THREE.CylinderGeometry(0.03, 0.03, 0.11, 8)
  hub.rotateZ(Math.PI / 2)
  parts.push(bakeGeometry(hub, null, { all: COLORS.dark }, 0))
  // A bright marker so the spin reads at speed.
  _m.compose(new V3(0, rimR, 0), _q.identity(), _s.set(0.03, 0.05, 0.05))
  parts.push(bakeGeometry(BOX, _m, { all: '#ffd23f' }, 0))
  return mergeBaked(parts)
}

/**
 * Frame and rider geometry per bicycle. All points are in the bike's local space
 * (x right, y up, z forward, ground at y = 0).
 */
const VARIANTS = {
  road: {
    wheelR: 0.34,
    tire: 0.035,
    spokes: 4,
    pts: {
      rearAxle: [0, 0.34, -0.53],
      frontAxle: [0, 0.34, 0.55],
      bb: [0, 0.3, -0.04],
      seatTop: [0, 0.86, -0.22],
      headTop: [0, 0.9, 0.4],
      headBot: [0, 0.74, 0.45],
    },
    seat: [0, 0.99, -0.24],
    bar: { rel: [0, 0.32, -0.05], half: 0.29, grip: 0.26 },
    hip: [1.06, -0.22],
    sh: [1.44, 0.08],
    standBias: 0,
  },
  bmx: {
    wheelR: 0.27,
    tire: 0.045,
    spokes: 3,
    mags: true,
    pts: {
      rearAxle: [0, 0.27, -0.43],
      frontAxle: [0, 0.27, 0.47],
      bb: [0, 0.29, -0.02],
      seatTop: [0, 0.66, -0.2],
      headTop: [0, 0.78, 0.36],
      headBot: [0, 0.64, 0.41],
    },
    seat: [0, 0.74, -0.23],
    bar: { rel: [0, 0.4, -0.1], half: 0.31, grip: 0.29, riser: true },
    hip: [0.94, -0.16],
    sh: [1.33, 0.12],
    standBias: 0.45,
    pegs: true,
  },
  mtb: {
    wheelR: 0.36,
    tire: 0.06,
    spokes: 6,
    knobs: true,
    pts: {
      rearAxle: [0, 0.36, -0.55],
      frontAxle: [0, 0.36, 0.6],
      bb: [0, 0.34, -0.04],
      seatTop: [0, 0.84, -0.24],
      headTop: [0, 0.93, 0.42],
      headBot: [0, 0.77, 0.47],
    },
    seat: [0, 0.98, -0.26],
    bar: { rel: [0, 0.3, -0.04], half: 0.37, grip: 0.33 },
    hip: [1.07, -0.23],
    sh: [1.45, 0.1],
    standBias: 0.1,
    suspension: true,
  },
}

/** Low-poly bicycle (road, BMX or mountain bike) with an IK-driven rider that pedals, leans, crouches and stands. */
export class BikeModel {
  constructor(palette = null, variant = 'road', riderId = 'classic') {
    const L = riderLook(riderId)
    this.look = L
    const PAL = palette ? { ...COLORS, ...palette } : COLORS
    const VA = (this.variant = VARIANTS[variant] || VARIANTS.road)
    this.wheelR = VA.wheelR
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()
    this.root.add(this.tilt)
    const baked = new THREE.MeshLambertMaterial({ vertexColors: true })

    this.pts = {}
    for (const [k, p] of Object.entries(VA.pts)) this.pts[k] = new V3(...p)
    const P = this.pts

    const frame = []
    const c = { all: PAL.frame }
    frame.push(bakeGeometry(CYL, tubeMatrix(P.bb, P.seatTop, 0.024), c, 0))
    frame.push(bakeGeometry(CYL, tubeMatrix(P.seatTop, P.headTop, 0.024), c, 0))
    frame.push(bakeGeometry(CYL, tubeMatrix(P.bb, P.headBot, 0.028), c, 0))
    frame.push(bakeGeometry(CYL, tubeMatrix(P.headBot, new V3(0, 0.95, 0.38), 0.032), c, 0))
    for (const s of [-1, 1]) {
      const axle = P.rearAxle.clone().setX(s * 0.06)
      frame.push(bakeGeometry(CYL, tubeMatrix(P.bb.clone().setX(s * 0.03), axle, 0.015), c, 0))
      frame.push(bakeGeometry(CYL, tubeMatrix(P.seatTop.clone().setX(s * 0.02), axle, 0.014), c, 0))
    }
    const seat = new V3(...VA.seat)
    frame.push(bakeGeometry(CYL, tubeMatrix(P.seatTop, seat.clone().add(new V3(0, -0.02, -0.01)), 0.016), { all: COLORS.silver }, 0))
    _m.compose(seat, _q.identity(), _s.set(0.14, 0.05, 0.27))
    frame.push(bakeGeometry(BOX, _m, { all: COLORS.dark }, 0))
    const bbY = P.bb.y
    const ra = P.rearAxle
    frame.push(bakeGeometry(CYL, tubeMatrix(new V3(-0.06, bbY + 0.09, P.bb.z), new V3(-0.06, ra.y + 0.04, ra.z), 0.008), { all: COLORS.dark }, 0))
    frame.push(bakeGeometry(CYL, tubeMatrix(new V3(-0.06, bbY - 0.09, P.bb.z), new V3(-0.06, ra.y - 0.04, ra.z), 0.008), { all: COLORS.dark }, 0))
    if (VA.pegs) {
      // BMX stunt pegs on the rear axle
      for (const s of [-1, 1]) {
        const peg = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8)
        peg.rotateZ(Math.PI / 2)
        peg.translate(s * 0.13, ra.y, ra.z)
        frame.push(bakeGeometry(peg, null, { all: COLORS.silver }, 0))
      }
    }
    if (VA.suspension) {
      // rear shock between the seat tube and the top tube
      const a = P.bb.clone().lerp(P.seatTop, 0.55)
      const b = P.seatTop.clone().lerp(P.headTop, 0.4)
      frame.push(bakeGeometry(CYL, tubeMatrix(a, b, 0.03), { all: '#ffd23f' }, 0))
      frame.push(bakeGeometry(CYL, tubeMatrix(a.clone().lerp(b, 0.2), a.clone().lerp(b, 0.8), 0.04), { all: COLORS.dark }, 0))
    }
    const ring = new THREE.CylinderGeometry(0.09, 0.09, 0.015, 14)
    ring.rotateZ(Math.PI / 2)
    ring.translate(-0.06, P.bb.y, P.bb.z)
    frame.push(bakeGeometry(ring, null, { all: COLORS.silver }, 0))
    this.tilt.add(new THREE.Mesh(mergeBaked(frame), baked))

    const wheelGeo = buildWheel(VA.wheelR, VA.tire, VA.spokes, VA.mags ? PAL.frame : COLORS.silver, VA.knobs)
    this.rearWheel = new THREE.Mesh(wheelGeo, baked)
    this.rearWheel.position.copy(P.rearAxle)
    this.tilt.add(this.rearWheel)

    this.front = new THREE.Group()
    this.front.position.copy(P.headBot)
    this.tilt.add(this.front)
    const fork = []
    const axleRel = P.frontAxle.clone().sub(P.headBot)
    const forkW = VA.knobs ? 0.08 : 0.05
    for (const s of [-1, 1]) {
      const top = new V3(s * (forkW - 0.01), 0.02, 0)
      const end = axleRel.clone().setX(s * forkW)
      if (VA.suspension) {
        // fat stanchions on top, slim lowers down to the axle
        const mid = top.clone().lerp(end, 0.5)
        fork.push(bakeGeometry(CYL, tubeMatrix(top, mid, 0.026), { all: COLORS.dark }, 0))
        fork.push(bakeGeometry(CYL, tubeMatrix(mid, end, 0.02), { all: COLORS.silver }, 0))
      } else fork.push(bakeGeometry(CYL, tubeMatrix(top, end, VA.mags ? 0.02 : 0.016), { all: VA.mags ? PAL.frame : COLORS.silver }, 0))
    }
    const B = VA.bar
    this.barRel = new V3(...B.rel)
    this.gripX = B.grip
    const by = this.barRel.y
    const bz = this.barRel.z
    fork.push(bakeGeometry(CYL, tubeMatrix(new V3(0, 0.18, -0.04), this.barRel, 0.018), { all: COLORS.dark }, 0))
    fork.push(bakeGeometry(CYL, tubeMatrix(new V3(-B.half, by, bz), new V3(B.half, by, bz), 0.014), { all: COLORS.silver }, 0))
    if (B.riser) {
      // BMX riser bars with a crossbar
      for (const s of [-1, 1]) fork.push(bakeGeometry(CYL, tubeMatrix(new V3(s * 0.05, 0.2, -0.04), new V3(s * 0.16, by, bz), 0.012), { all: COLORS.silver }, 0))
      fork.push(bakeGeometry(CYL, tubeMatrix(new V3(-0.11, by - 0.09, bz + 0.01), new V3(0.11, by - 0.09, bz + 0.01), 0.011), { all: COLORS.silver }, 0))
      _m.compose(new V3(0, by - 0.05, bz + 0.03), _q.identity(), _s.set(0.12, 0.08, 0.02))
      fork.push(bakeGeometry(BOX, _m, { all: PAL.frame }, 0))
    }
    for (const s of [-1, 1]) fork.push(bakeGeometry(CYL, tubeMatrix(new V3(s * (B.half - 0.09), by, bz), new V3(s * (B.half + 0.01), by, bz), 0.022), { all: COLORS.dark }, 0))
    this.front.add(new THREE.Mesh(mergeBaked(fork), baked))
    this.frontWheel = new THREE.Mesh(wheelGeo, baked)
    this.frontWheel.position.copy(axleRel)
    this.front.add(this.frontWheel)

    this.crankGroup = new THREE.Group()
    this.crankGroup.position.copy(P.bb)
    this.tilt.add(this.crankGroup)
    const crank = []
    _m.compose(new V3(-0.1, -CRANK_L / 2, 0), _q.identity(), _s.set(0.02, CRANK_L, 0.035))
    crank.push(bakeGeometry(BOX, _m, { all: COLORS.silver }, 0))
    _m.compose(new V3(0.1, CRANK_L / 2, 0), _q.identity(), _s.set(0.02, CRANK_L, 0.035))
    crank.push(bakeGeometry(BOX, _m, { all: COLORS.silver }, 0))
    this.crankGroup.add(new THREE.Mesh(mergeBaked(crank), baked))
    const pedalGeo = bakeGeometry(new THREE.BoxGeometry(0.1, 0.025, 0.07), null, { all: COLORS.dark }, 0)
    this.pedalR = new THREE.Mesh(pedalGeo, baked)
    this.pedalL = new THREE.Mesh(pedalGeo, baked)
    this.pedalR.position.set(-0.15, -CRANK_L, 0)
    this.pedalL.position.set(0.15, CRANK_L, 0)
    this.crankGroup.add(this.pedalR, this.pedalL)

    const mat = (color) => new THREE.MeshLambertMaterial({ color })
    const m = {
      jersey: mat(L ? L.jacket : PAL.jersey),
      jerseyDark: mat(PAL.jerseyDark),
      shorts: mat(L ? L.pants : COLORS.shorts),
      skin: mat(L ? L.skin : COLORS.skin),
      helmet: mat(PAL.helmet),
      shoe: mat(L ? L.shoe : COLORS.shoe),
      dark: mat(COLORS.dark),
    }
    // Characters wear long or short sleeves, full-length pants and bare hands instead of the classic kit.
    const longSleeves = !!L && L.sleeves === 'long'
    const sleeveMat = L ? mat(longSleeves ? L.sleeve : L.under) : m.jerseyDark
    const foreMat = longSleeves ? sleeveMat : m.skin
    const legMat = L ? m.shorts : m.skin
    const accent = L ? accentMaterial(L) : null
    const limb = (material) => {
      const mesh = new THREE.Mesh(CYL, material)
      this.tilt.add(mesh)
      return mesh
    }
    const ball = (material, r) => {
      const mesh = new THREE.Mesh(SPHERE, material)
      mesh.scale.setScalar(r)
      this.tilt.add(mesh)
      return mesh
    }
    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.34, 3, 8), m.jersey)
    this.tilt.add(this.torso)
    this.pelvis = ball(m.shorts, 0.15)
    this.head = ball(m.skin, 0.115)
    this.helmet = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.helmet)
    this.helmet.scale.set(1, 0.95, 1.18)
    this.tilt.add(this.helmet)
    this.visor = new THREE.Mesh(BOX, m.dark)
    this.visor.scale.set(0.2, 0.04, 0.06)
    this.tilt.add(this.visor)

    if (L) {
      // jacket details ride on the torso mesh: side panels, back yoke, collar, zip and glowing waist band
      const detail = (geo, material, pos, scale, rot) => {
        const d = new THREE.Mesh(geo, material)
        d.position.set(...pos)
        d.scale.set(...scale)
        if (rot) d.rotation.set(...rot)
        this.torso.add(d)
      }
      const panelDepth = L.glow ? 0.05 : 0.15
      for (const s of [-1, 1]) detail(BOX, accent, [s * 0.15, -0.05, 0.02], [0.03, 0.34, panelDepth])
      detail(BOX, accent, [0, 0.18, -0.148], [0.3, 0.09, 0.03])
      if (L.zip) detail(BOX, accent, [0, -0.02, 0.158], [0.022, 0.34, 0.02])
      if (L.collar) detail(new THREE.CylinderGeometry(0.078, 0.095, 0.07, 10), m.jersey, [0, 0.31, 0], [1, 1, 1])
      if (L.glow) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.153, 0.016, 5, 16), accent)
        ring.rotation.x = Math.PI / 2
        ring.position.y = -0.19
        this.torso.add(ring)
      }
      this.hair = makeHair(L)
      this.tilt.add(this.hair)
      this.helmet.visible = false
      this.visor.visible = false
    }

    this.legs = [-1, 1].map((s) => ({
      s,
      thigh: limb(m.shorts),
      shin: limb(legMat),
      knee: ball(legMat, 0.058),
      shoe: (() => {
        const mesh = new THREE.Mesh(BOX, m.shoe)
        mesh.scale.set(0.09, 0.07, 0.2)
        if (!L) {
          this.tilt.add(mesh)
          return mesh
        }
        // character shoe: upper, sole, accent strip and (for boots / high-tops) a shaft
        const g = new THREE.Group()
        const part = (material, pos, scale) => {
          const p = new THREE.Mesh(BOX, material)
          p.position.set(...pos)
          p.scale.set(...scale)
          g.add(p)
        }
        part(m.shoe, [0, 0, 0], [0.09, 0.07, 0.2])
        part(mat(L.sole), [0, -0.045, 0.004], [0.098, 0.028, 0.215])
        part(accent, [0, 0.038, 0.02], [0.094, 0.014, 0.07])
        if (L.boot) part(m.shoe, [0, 0.07, -0.05], [0.086, 0.08, 0.09])
        this.tilt.add(g)
        return g
      })(),
    }))
    this.arms = [-1, 1].map((s) => ({
      s,
      upper: limb(sleeveMat),
      fore: limb(foreMat),
      elbow: ball(foreMat === m.skin ? m.skin : sleeveMat, 0.045),
      hand: ball(L ? m.skin : m.dark, 0.05),
      shoulder: ball(L ? accent : m.jersey, 0.075),
    }))

    this.crank = 0
    this.wheelAngle = 0
    this.steerVis = 0
    this.lean = 0
    this.pitch = 0
    this.crashRoll = 0
    this.stand = 0
    this.crouch = 0
    this.standTimer = 0
    this.normal = new V3(0, 1, 0)

    this._qa = new THREE.Quaternion()
    this._qy = new THREE.Quaternion()
    this._tmp = {
      hipC: new V3(),
      shC: new V3(),
      hip: new V3(),
      foot: new V3(),
      knee: new V3(),
      sh: new V3(),
      grip: new V3(),
      elbow: new V3(),
      headPos: new V3(),
    }
    this.kneePole = new V3(0, 0.25, 1)
    this.armPoles = [new V3(-0.6, -0.4, -0.35), new V3(0.6, -0.4, -0.35)]
  }

  popStand() {
    this.standTimer = 0.45
  }

  /** Returns the number of half crank turns this frame, used for pedal tick sounds. */
  update(dt, s) {
    const k = (rate) => 1 - Math.exp(-rate * dt)
    this.normal.lerp(s.grounded ? s.normal : UP, k(s.grounded ? 14 : 3)).normalize()
    this._qa.setFromUnitVectors(UP, this.normal)
    this._qy.setFromAxisAngle(UP, s.yaw)
    this.root.quaternion.multiplyQuaternions(this._qa, this._qy)
    this.root.position.copy(s.pos).addScaledVector(this.normal, -BIKE.RADIUS)

    const speedF = Math.min(1, Math.abs(s.speed) / 7)
    const leanTarget = s.crashed ? 0 : s.steer * speedF * 0.48
    this.lean += (leanTarget - this.lean) * k(7)
    this.crashRoll += ((s.crashed ? s.crashSide * 1.35 : 0) - this.crashRoll) * k(s.crashed ? 9 : 5)
    const pitchTarget = s.grounded ? 0 : Math.max(-0.45, Math.min(0.45, -Math.atan2(s.vy, Math.max(4, s.hSpeed)) * 0.5))
    this.pitch += (pitchTarget - this.pitch) * k(5)
    this.tilt.rotation.set(this.pitch, 0, this.lean + this.crashRoll)

    this.steerVis += (-s.steer * (0.15 + 0.3 * (1 - speedF)) - this.steerVis) * k(10)
    this.front.rotation.y = this.steerVis

    this.wheelAngle += (s.speed / this.wheelR) * dt
    this.rearWheel.rotation.x = this.wheelAngle
    this.frontWheel.rotation.x = this.wheelAngle

    let ticks = 0
    if (s.pedaling) {
      const before = Math.floor(this.crank / Math.PI)
      this.crank += (Math.max(Math.abs(s.speed), 2.5) / this.wheelR) * 0.26 * dt
      ticks = Math.floor(this.crank / Math.PI) - before
    }
    this.crankGroup.rotation.x = this.crank
    this.pedalR.rotation.x = -this.crank
    this.pedalL.rotation.x = -this.crank

    this.standTimer = Math.max(0, this.standTimer - dt)
    const standTarget = !s.grounded || this.standTimer > 0 ? 1 : this.variant.standBias
    this.stand += (standTarget - this.stand) * k(8)
    this.crouch += ((s.pedaling ? 1 : 0.3) - this.crouch) * k(4)
    this.updateRider()
    return ticks
  }

  updateRider() {
    const t = this._tmp
    const P = this.pts
    const st = this.stand
    const cr = this.crouch
    const VA = this.variant
    t.hipC.set(0, VA.hip[0] + st * 0.15, VA.hip[1] + st * 0.14)
    t.shC.set(0, VA.sh[0] - cr * 0.07 + st * 0.04, VA.sh[1] + cr * 0.07 + st * 0.08)

    this.pelvis.position.copy(t.hipC)
    placeBetween(this.torso, t.hipC, t.shC, 1)
    this.torso.scale.set(1, 1, 1)
    this.torso.position.lerpVectors(t.hipC, t.shC, 0.5)

    t.headPos.set(0, t.shC.y + 0.2, t.shC.z + 0.07 + cr * 0.03)
    this.head.position.copy(t.headPos)
    this.helmet.position.set(0, t.headPos.y + 0.025, t.headPos.z - 0.01)
    this.helmet.rotation.x = 0.25 + cr * 0.15
    this.visor.position.set(0, t.headPos.y + 0.03, t.headPos.z + 0.15)
    if (this.hair) {
      this.hair.position.copy(this.helmet.position)
      this.hair.rotation.x = this.helmet.rotation.x
    }

    const c = Math.cos(this.crank)
    const sn = Math.sin(this.crank)
    for (const leg of this.legs) {
      const s = leg.s
      t.hip.set(s * 0.1, t.hipC.y - 0.03, t.hipC.z)
      if (s < 0) t.foot.set(-0.15, P.bb.y - CRANK_L * c + 0.04, P.bb.z - CRANK_L * sn)
      else t.foot.set(0.15, P.bb.y + CRANK_L * c + 0.04, P.bb.z + CRANK_L * sn)
      solveIK(t.hip, t.foot, 0.47, 0.46, this.kneePole, t.knee)
      placeBetween(leg.thigh, t.hip, t.knee, 0.075)
      placeBetween(leg.shin, t.knee, t.foot, 0.055)
      leg.knee.position.copy(t.knee)
      leg.shoe.position.set(t.foot.x, t.foot.y + 0.01, t.foot.z + 0.04)
    }

    const sa = this.steerVis
    const ca = Math.cos(sa)
    const sa_ = Math.sin(sa)
    for (const arm of this.arms) {
      const s = arm.s
      t.sh.set(s * 0.17, t.shC.y - 0.02, t.shC.z)
      const gx = s * this.gripX
      const gz = this.barRel.z
      t.grip.set(P.headBot.x + gx * ca + gz * sa_, P.headBot.y + this.barRel.y, P.headBot.z - gx * sa_ + gz * ca)
      solveIK(t.sh, t.grip, 0.3, 0.29, this.armPoles[s < 0 ? 0 : 1], t.elbow)
      placeBetween(arm.upper, t.sh, t.elbow, 0.05)
      placeBetween(arm.fore, t.elbow, t.grip, 0.042)
      arm.elbow.position.copy(t.elbow)
      arm.hand.position.copy(t.grip)
      arm.shoulder.position.copy(t.sh)
    }
  }
}
