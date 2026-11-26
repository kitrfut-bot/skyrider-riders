import * as THREE from 'three'
import { bakeGeometry, mergeBaked } from './geo.js'
import { BIKE } from './constants.js'
import { BikeModel } from './bikeModel.js'
import { getVehicle } from './vehicles.js'
import { riderLook } from './riders.js'
import { makeHair } from './riderParts.js'

const V3 = THREE.Vector3
const UP = new V3(0, 1, 0)
const BOX = new THREE.BoxGeometry(1, 1, 1)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new V3()
const _d = new V3()

const C = {
  paint: '#ff3d57',
  dark: '#23252e',
  tire: '#1b1c22',
  silver: '#cfd6dd',
  glass: '#9fd3ff',
  light: '#fff6c8',
  tail: '#ff2a3d',
  skin: '#e8a27c',
  helmet: '#ffb000',
}

/** Box at a position with an optional Euler rotation, baked with one colour. */
function box(pos, size, color, rot) {
  _q.setFromEuler(_e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0))
  _m.compose(new V3(...pos), _q, _s.set(...size))
  return bakeGeometry(BOX, _m, { all: color }, 0)
}

/** Cylinder between two points. */
function tube(a, b, r0, r1 = r0, color, seg = 8) {
  const A = new V3(...a)
  const B = new V3(...b)
  _d.subVectors(B, A)
  const len = _d.length() || 0.0001
  _q.setFromUnitVectors(UP, _d.divideScalar(len))
  const g = new THREE.CylinderGeometry(r1, r0, 1, seg)
  _m.compose(A.add(B).multiplyScalar(0.5), _q, _s.set(1, len, 1))
  const baked = bakeGeometry(g, _m, { all: color }, 0)
  g.dispose()
  return baked
}

function glowMaterial(color, opacity = 0.85) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
}

/** Shared pose code: align with the ground, follow yaw, sit the model on the contact point. */
class PosedModel {
  constructor() {
    this.root = new THREE.Group()
    this.tilt = new THREE.Group()
    this.root.add(this.tilt)
    this.normal = new V3(0, 1, 0)
    this._qa = new THREE.Quaternion()
    this._qy = new THREE.Quaternion()
    this.pitch = 0
    this.roll = 0
    this.crashRoll = 0
    this.prevSpeed = 0
    this.accelVis = 0
  }

  pose(dt, s, alignGround = true) {
    const k = (rate) => 1 - Math.exp(-rate * dt)
    const useGround = alignGround && s.grounded
    this.normal.lerp(useGround ? s.normal : UP, k(useGround ? 14 : 3)).normalize()
    this._qa.setFromUnitVectors(UP, this.normal)
    this._qy.setFromAxisAngle(UP, s.yaw)
    this.root.quaternion.multiplyQuaternions(this._qa, this._qy)
    this.root.position.copy(s.pos).addScaledVector(this.normal, -BIKE.RADIUS)
    const a = dt > 0 ? (s.speed - this.prevSpeed) / dt : 0
    this.prevSpeed = s.speed
    this.accelVis += (Math.max(-12, Math.min(12, a)) - this.accelVis) * k(4)
    return k
  }

  popStand() {}
}

/** Flying car: drives on four wheels, folds them into hover pads and opens wings in the air. */
export class CarModel extends PosedModel {
  constructor(palette = null, riderId = 'classic') {
    const L = riderLook(riderId)
    super()
    const paint = palette ? palette.frame : C.paint
    const helmet = palette ? palette.helmet : C.helmet
    const baked = new THREE.MeshLambertMaterial({ vertexColors: true })

    const body = [
      // chassis and nose
      box([0, 0.42, 0], [1.28, 0.3, 2.3], paint),
      box([0, 0.47, 1.17], [1.18, 0.2, 0.36], paint, [0.35, 0, 0]),
      box([0, 0.3, 0], [1.1, 0.08, 2.2], C.dark),
      // side skirts and bumpers
      box([0.66, 0.36, 0], [0.06, 0.16, 1.9], C.dark),
      box([-0.66, 0.36, 0], [0.06, 0.16, 1.9], C.dark),
      box([0, 0.33, 1.3], [1.2, 0.12, 0.08], C.dark),
      box([0, 0.36, -1.18], [1.2, 0.16, 0.1], C.dark),
      // cabin roof and pillars (glass is a separate see-through mesh)
      box([0, 0.97, -0.25], [0.96, 0.06, 0.82], paint),
      box([0.46, 0.76, 0.18], [0.05, 0.4, 0.05], paint, [-0.5, 0, 0]),
      box([-0.46, 0.76, 0.18], [0.05, 0.4, 0.05], paint, [-0.5, 0, 0]),
      box([0.46, 0.76, -0.66], [0.05, 0.4, 0.05], paint, [0.4, 0, 0]),
      box([-0.46, 0.76, -0.66], [0.05, 0.4, 0.05], paint, [0.4, 0, 0]),
      // lights
      box([0.4, 0.5, 1.3], [0.24, 0.08, 0.04], C.light),
      box([-0.4, 0.5, 1.3], [0.24, 0.08, 0.04], C.light),
      box([0.42, 0.5, -1.24], [0.26, 0.07, 0.04], C.tail),
      box([-0.42, 0.5, -1.24], [0.26, 0.07, 0.04], C.tail),
      // rear spoiler
      box([0.45, 0.72, -1.05], [0.05, 0.22, 0.08], C.dark),
      box([-0.45, 0.72, -1.05], [0.05, 0.22, 0.08], C.dark),
      box([0, 0.84, -1.08], [1.34, 0.05, 0.26], paint, [-0.08, 0, 0]),
      // thrusters
      tube([0.34, 0.5, -1.0], [0.34, 0.5, -1.36], 0.13, 0.1, C.silver, 10),
      tube([-0.34, 0.5, -1.0], [-0.34, 0.5, -1.36], 0.13, 0.1, C.silver, 10),
      tube([0.34, 0.5, -1.34], [0.34, 0.5, -1.38], 0.09, 0.09, C.dark, 10),
      tube([-0.34, 0.5, -1.34], [-0.34, 0.5, -1.38], 0.09, 0.09, C.dark, 10),
    ]
    this.tilt.add(new THREE.Mesh(mergeBaked(body), baked))

    const glassGeo = mergeBaked([
      box([0, 0.77, 0.2], [0.9, 0.36, 0.04], C.glass, [-0.6, 0, 0]),
      box([0, 0.78, -0.68], [0.9, 0.34, 0.04], C.glass, [0.45, 0, 0]),
      box([0.47, 0.77, -0.25], [0.02, 0.3, 0.8], C.glass),
      box([-0.47, 0.77, -0.25], [0.02, 0.3, 0.8], C.glass),
    ])
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }))
    glass.renderOrder = 2

    // driver
    const skin = new THREE.MeshLambertMaterial({ color: L ? L.skin : C.skin })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin)
    head.position.set(0.2, 0.78, -0.22)
    const hel = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: helmet }))
    hel.position.set(0.2, 0.8, -0.23)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.18, 3, 8), new THREE.MeshLambertMaterial({ color: L ? L.jacket : C.dark }))
    torso.position.set(0.2, 0.58, -0.28)
    this.tilt.add(head, torso)
    if (L) {
      const hair = makeHair(L)
      hair.position.copy(hel.position)
      hair.rotation.x = 0.1
      hair.scale.setScalar(1.13)
      this.tilt.add(hair)
    } else this.tilt.add(hel)
    this.tilt.add(glass)

    // wings fold out from the sides when flying
    this.wings = [-1, 1].map((side) => {
      const g = new THREE.Group()
      g.position.set(side * 0.62, 0.5, -0.2)
      const geo = mergeBaked([
        box([side * 0.42, 0, 0], [0.84, 0.04, 0.7], paint),
        box([side * 0.8, 0.08, -0.22], [0.06, 0.18, 0.32], C.dark),
        box([side * 0.42, 0.025, 0.28], [0.8, 0.02, 0.06], C.light),
      ])
      g.add(new THREE.Mesh(geo, baked))
      g.scale.set(0.02, 1, 1)
      g.visible = false
      this.tilt.add(g)
      return g
    })

    // wheels fold flat into hover pads in the air
    const tireGeo = (() => {
      const t = new THREE.CylinderGeometry(0.27, 0.27, 0.22, 14)
      t.rotateZ(Math.PI / 2)
      const hub = new THREE.CylinderGeometry(0.15, 0.15, 0.235, 10)
      hub.rotateZ(Math.PI / 2)
      const mark = new THREE.BoxGeometry(0.24, 0.06, 0.06)
      mark.translate(0, 0.12, 0)
      return mergeBaked([bakeGeometry(t, null, { all: C.tire }, 0), bakeGeometry(hub, null, { all: C.silver }, 0), bakeGeometry(mark, null, { all: paint }, 0)])
    })()
    const padGlow = glowMaterial('#7fe8ff', 0.7)
    const padGeo = new THREE.CircleGeometry(0.24, 16)
    this.wheels = []
    for (const [x, z] of [
      [0.62, 0.78],
      [-0.62, 0.78],
      [0.62, -0.74],
      [-0.62, -0.74],
    ]) {
      const pivot = new THREE.Group()
      pivot.position.set(x, 0.27, z)
      const fold = new THREE.Group()
      pivot.add(fold)
      const wheel = new THREE.Mesh(tireGeo, baked)
      fold.add(wheel)
      // glowing disc on the face that points down once the wheel is folded flat
      const pad = new THREE.Mesh(padGeo, padGlow)
      pad.rotation.y = -Math.sign(x) * (Math.PI / 2)
      pad.position.set(-Math.sign(x) * 0.12, 0, 0)
      pad.visible = false
      fold.add(pad)
      this.tilt.add(pivot)
      this.wheels.push({ pivot, fold, wheel, pad, side: Math.sign(x), front: z > 0 })
    }

    // thruster flames
    const flameGeo = new THREE.ConeGeometry(0.11, 0.9, 10, 1, true)
    flameGeo.rotateX(-Math.PI / 2)
    flameGeo.translate(0, 0, -0.45)
    this.flameMat = glowMaterial('#ffb347', 0.9)
    this.flames = [-0.34, 0.34].map((x) => {
      const f = new THREE.Mesh(flameGeo, this.flameMat)
      f.position.set(x, 0.5, -1.38)
      f.visible = false
      this.tilt.add(f)
      return f
    })

    this.fold = 0
    this.wingOut = 0
    this.flame = 0
    this.wheelAngle = 0
    this.steerVis = 0
    this.airTimer = 0
    this.time = 0
  }

  update(dt, s) {
    const k = this.pose(dt, s)
    this.time += dt
    this.airTimer = s.grounded ? 0 : this.airTimer + dt
    const flying = !s.grounded && (this.airTimer > 0.25 || s.lift)
    this.fold += ((flying ? 1 : 0) - this.fold) * k(7)
    this.wingOut += ((flying && !s.crashed ? 1 : 0) - this.wingOut) * k(6)
    this.flame += ((s.lift ? 1 : 0) - this.flame) * k(s.lift ? 18 : 10)

    const speedF = Math.min(1, Math.abs(s.speed) / 8)
    const rollTarget = s.crashed ? 0 : s.grounded ? -s.steer * speedF * 0.05 : s.steer * 0.45
    this.roll += (rollTarget - this.roll) * k(6)
    this.crashRoll += ((s.crashed ? s.crashSide * 0.7 : 0) - this.crashRoll) * k(s.crashed ? 8 : 5)
    const pitchTarget = s.grounded ? -this.accelVis * 0.006 : Math.max(-0.35, Math.min(0.35, -Math.atan2(s.vy, Math.max(4, s.hSpeed)) * 0.6))
    this.pitch += (pitchTarget - this.pitch) * k(5)
    this.tilt.rotation.set(this.pitch, 0, this.roll + this.crashRoll)
    this.tilt.position.y = this.fold * 0.08 + (flying ? Math.sin(this.time * 3) * 0.03 : 0)

    this.steerVis += (-s.steer * 0.4 * (1 - this.fold) - this.steerVis) * k(10)
    this.wheelAngle += (s.speed / 0.27) * dt * (1 - this.fold)
    for (const w of this.wheels) {
      w.pivot.rotation.y = w.front ? this.steerVis : 0
      w.fold.rotation.z = w.side * this.fold * (Math.PI / 2)
      w.fold.position.x = -w.side * this.fold * 0.05
      w.wheel.rotation.x = this.wheelAngle
      w.pad.visible = this.fold > 0.6
    }
    for (const wg of this.wings) {
      wg.visible = this.wingOut > 0.03
      wg.scale.x = Math.max(0.02, this.wingOut)
    }
    const fl = this.flame
    for (const f of this.flames) {
      f.visible = fl > 0.05
      f.scale.set(0.7 + fl * 0.5, 0.7 + fl * 0.5, fl * (0.85 + Math.random() * 0.3))
    }
    this.flameMat.opacity = 0.5 + fl * 0.45
    return 0
  }
}

/** Helicopter with a spinning main and tail rotor, skids and a pilot in a glass bubble. */
export class HeliModel extends PosedModel {
  constructor(palette = null, riderId = 'classic') {
    const L = riderLook(riderId)
    super()
    const paint = palette ? palette.frame : C.paint
    const helmet = palette ? palette.helmet : C.helmet
    const baked = new THREE.MeshLambertMaterial({ vertexColors: true })

    const cabin = new THREE.SphereGeometry(0.62, 14, 10)
    _m.compose(new V3(0, 0.95, -0.05), _q.identity(), _s.set(1, 0.82, 1.3))
    const engine = new THREE.CylinderGeometry(0.3, 0.36, 0.5, 10)
    _q.setFromAxisAngle(new V3(1, 0, 0), Math.PI / 2)
    const parts = [
      bakeGeometry(cabin, _m, { all: paint }, 0),
      bakeGeometry(engine, new THREE.Matrix4().compose(new V3(0, 1.38, -0.4), _q.clone(), new V3(1, 1, 1)), { all: C.dark }, 0),
      // tail boom, fin and stabiliser
      tube([0, 1.05, -0.6], [0, 1.2, -2.05], 0.15, 0.06, paint, 10),
      box([0, 1.45, -2.0], [0.05, 0.55, 0.3], paint, [-0.35, 0, 0]),
      box([0, 1.18, -1.8], [0.7, 0.04, 0.2], C.dark),
      box([0, 1.03, 0.1], [1.06, 0.06, 0.5], C.dark),
      // mast
      tube([0, 1.4, -0.1], [0, 1.78, -0.1], 0.05, 0.05, C.dark),
      // skids and struts
      tube([0.5, 0.06, -0.75], [0.5, 0.06, 0.75], 0.035, 0.035, C.silver),
      tube([-0.5, 0.06, -0.75], [-0.5, 0.06, 0.75], 0.035, 0.035, C.silver),
      tube([0.5, 0.06, 0.75], [0.5, 0.16, 0.9], 0.035, 0.035, C.silver),
      tube([-0.5, 0.06, 0.75], [-0.5, 0.16, 0.9], 0.035, 0.035, C.silver),
      tube([0.5, 0.06, 0.4], [0.3, 0.55, 0.3], 0.03, 0.03, C.dark),
      tube([-0.5, 0.06, 0.4], [-0.3, 0.55, 0.3], 0.03, 0.03, C.dark),
      tube([0.5, 0.06, -0.45], [0.3, 0.55, -0.4], 0.03, 0.03, C.dark),
      tube([-0.5, 0.06, -0.45], [-0.3, 0.55, -0.4], 0.03, 0.03, C.dark),
      // lights
      box([0, 0.62, 0.72], [0.16, 0.06, 0.06], C.light),
      box([0, 1.22, -2.12], [0.08, 0.08, 0.06], C.tail),
    ]
    this.tilt.add(new THREE.Mesh(mergeBaked(parts), baked))

    // glass bubble over the pilot
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 14, 10, -Math.PI / 2, Math.PI, 0, Math.PI * 0.62),
      new THREE.MeshLambertMaterial({ color: C.glass, transparent: true, opacity: 0.42, depthWrite: false }),
    )
    bubble.scale.set(0.95, 0.85, 1.05)
    bubble.position.set(0, 0.98, 0.32)
    bubble.renderOrder = 2

    const skin = new THREE.MeshLambertMaterial({ color: L ? L.skin : C.skin })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin)
    head.position.set(0, 1.18, 0.35)
    const hel = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: helmet }))
    hel.position.set(0, 1.2, 0.34)
    this.tilt.add(head, bubble)
    if (L) {
      const hair = makeHair(L)
      hair.position.copy(hel.position)
      hair.rotation.x = 0.1
      hair.scale.setScalar(1.13)
      this.tilt.add(hair)
    } else this.tilt.add(hel)

    // main rotor
    this.rotor = new THREE.Group()
    this.rotor.position.set(0, 1.8, -0.1)
    const bladeGeo = mergeBaked([
      box([0, 0, 0], [3.5, 0.03, 0.2], C.dark),
      box([0, 0, 0], [0.2, 0.03, 3.5], C.dark),
      box([1.68, 0.005, 0], [0.14, 0.035, 0.21], '#ffd23f'),
      box([-1.68, 0.005, 0], [0.14, 0.035, 0.21], '#ffd23f'),
      box([0, 0.005, 1.68], [0.21, 0.035, 0.14], '#ffd23f'),
      box([0, 0.005, -1.68], [0.21, 0.035, 0.14], '#ffd23f'),
      tube([0, -0.04, 0], [0, 0.08, 0], 0.1, 0.08, C.silver, 10),
    ])
    this.rotor.add(new THREE.Mesh(bladeGeo, baked))
    this.tilt.add(this.rotor)
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.75, 28),
      new THREE.MeshBasicMaterial({ color: '#23252e', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.disc.rotation.x = -Math.PI / 2
    this.disc.position.set(0, 1.8, -0.1)
    this.tilt.add(this.disc)

    // tail rotor
    this.tailRotor = new THREE.Group()
    this.tailRotor.position.set(0.1, 1.3, -2.02)
    this.tailRotor.add(new THREE.Mesh(mergeBaked([box([0, 0, 0], [0.03, 0.62, 0.08], C.dark), box([0, 0, 0], [0.03, 0.08, 0.62], C.dark)]), baked))
    this.tilt.add(this.tailRotor)

    this.rotorSpeed = 6
    this.rotorAngle = 0
    this.time = 0
    this.spin = 0
  }

  update(dt, s) {
    const k = this.pose(dt, s)
    this.time += dt
    const running = s.active !== false && !s.crashed
    const target = running ? (s.lift ? 34 : 28) : s.crashed ? 4 : 7
    this.rotorSpeed += (target - this.rotorSpeed) * k(s.crashed ? 1.5 : 2)
    this.rotorAngle += this.rotorSpeed * dt
    this.rotor.rotation.y = this.rotorAngle
    this.tailRotor.rotation.x = this.rotorAngle * 2.3
    this.disc.material.opacity = Math.max(0, (this.rotorSpeed - 12) / 22) * 0.16

    const speedF = Math.min(1, Math.abs(s.speed) / 6)
    const pitchTarget = s.grounded ? 0 : Math.max(-0.3, Math.min(0.35, s.speed * 0.017 + this.accelVis * 0.02))
    this.pitch += (pitchTarget - this.pitch) * k(4)
    const rollTarget = s.crashed || s.grounded ? 0 : s.steer * (0.12 + 0.25 * speedF)
    this.roll += (rollTarget - this.roll) * k(4)
    this.crashRoll += ((s.crashed ? s.crashSide * 0.8 : 0) - this.crashRoll) * k(s.crashed ? 6 : 4)
    this.spin = s.crashed ? this.spin + dt * 5 : this.spin * Math.exp(-6 * dt)
    this.tilt.rotation.set(this.pitch, this.spin, this.roll + this.crashRoll)
    this.tilt.position.y = !s.grounded && running ? Math.sin(this.time * 2.2) * 0.04 : 0
    return 0
  }
}

/** Builds the right 3D model for a garage vehicle. */
export function createVehicleModel(id, palette = null, riderId = 'classic') {
  const spec = getVehicle(id)
  if (spec.kind === 'car') return new CarModel(palette, riderId)
  if (spec.kind === 'heli') return new HeliModel(palette, riderId)
  return new BikeModel(palette, spec.id, riderId)
}

/** Label height and blob-shadow size per vehicle kind. */
export const KIND_LOOK = {
  bike: { label: 1.9, shadow: 1 },
  car: { label: 1.5, shadow: 1.6 },
  heli: { label: 2.4, shadow: 2 },
}
