import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { BIKE, GROUP, PHYS } from './constants.js'
import { getVehicle } from './vehicles.js'

const RAY_OPTS = { collisionFilterMask: GROUP.STATIC | GROUP.CRATE, skipBackfaces: true }
const ANTI_GRAVITY = -PHYS.GRAVITY

/**
 * Arcade vehicle on a frictionless physics sphere: cannon-es resolves contacts, gravity and
 * slopes, while this controller steers the velocity.
 *   bike: the original Sky Rider handling (ground steering, jumps)
 *   car:  ground handling like a bike, plus thrusters (limited energy) and a glide in the air
 *   heli: free flight with climb, descend and hover; gravity is cancelled while the rotor runs
 */
export class VehicleController {
  constructor(world, material) {
    this.world = world
    this.body = new CANNON.Body({
      mass: 70,
      material,
      shape: new CANNON.Sphere(BIKE.RADIUS),
      fixedRotation: true,
      linearDamping: 0.01,
      collisionFilterGroup: GROUP.BIKE,
      collisionFilterMask: GROUP.STATIC | GROUP.CRATE,
    })
    this.body.allowSleep = false
    world.addBody(this.body)

    this.setVehicle('road')
    this.ceiling = Infinity

    this.yaw = 0
    this.prevYaw = 0
    this.speed = 0
    this.grounded = false
    this.airTime = 0
    this.coyote = 0
    this.jumpBuffer = 0
    this.jumpLock = 0
    this.lastVy = 0
    this.lastGroundY = 0
    this.normal = new THREE.Vector3(0, 1, 0)
    this.groundVel = new CANNON.Vec3()
    this.prevPos = new THREE.Vector3()
    this.pos = new THREE.Vector3()
    this.crashed = false
    this.crashTimer = 0
    this.crashSide = 1
    this.pendingCrash = 0
    this.accelerating = false
    this.lifting = false
    this.energy = 1
    this.on = { jump() {}, land() {}, crash() {}, bump() {}, recover() {}, takeoff() {} }

    this.ray = new CANNON.RaycastResult()
    this._from = new CANNON.Vec3()
    this._to = new CANNON.Vec3()

    this.body.addEventListener('collide', (e) => this.onCollide(e))
  }

  /** Switch the handling to another garage vehicle. */
  setVehicle(id) {
    this.spec = getVehicle(id)
    this.kind = this.spec.kind
    this.P = this.spec.phys
    this.flies = this.kind !== 'bike'
  }

  onCollide(e) {
    const other = e.body
    const impact = Math.abs(e.contact.getImpactVelocityAlongNormal())
    if (other.collisionFilterGroup === GROUP.CRATE) {
      if (impact > 2) this.on.bump(impact)
      return
    }
    if (this.crashed) return
    const ny = Math.abs(e.contact.ni.y)
    if ((ny < 0.6 && impact > this.P.CRASH_WALL) || (ny >= 0.6 && impact > this.P.CRASH_LAND)) {
      this.pendingCrash = Math.max(this.pendingCrash, impact)
    }
  }

  reset(pos, yaw) {
    const b = this.body
    b.position.set(pos.x, pos.y, pos.z)
    b.previousPosition.set(pos.x, pos.y, pos.z)
    b.velocity.set(0, 0, 0)
    this.yaw = this.prevYaw = yaw
    this.speed = 0
    this.crashed = false
    this.crashTimer = 0
    this.pendingCrash = 0
    this.airTime = 0
    this.jumpBuffer = 0
    this.jumpLock = 0
    this.coyote = 0
    this.grounded = false
    this.lifting = false
    this.energy = 1
    this.lastGroundY = pos.y
    this.normal.set(0, 1, 0)
    this.pos.copy(pos)
    this.prevPos.copy(pos)
  }

  requestJump() {
    if (this.kind === 'bike') this.jumpBuffer = 0.15
  }

  beginStep() {
    const p = this.body.position
    this.prevPos.set(p.x, p.y, p.z)
    this.prevYaw = this.yaw
  }

  step(dt, input, enabled) {
    const b = this.body
    const v = b.velocity
    this.jumpLock = Math.max(0, this.jumpLock - dt)
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)
    if (this.crashed) this.crashTimer -= dt

    this._from.copy(b.position)
    this._to.set(b.position.x, b.position.y - BIKE.RADIUS - 0.35, b.position.z)
    this.ray.reset()
    this.world.raycastClosest(this._from, this._to, RAY_OPTS, this.ray)
    const hit = this.ray.hasHit && this.ray.hitNormalWorld.y > 0.45
    const wasGrounded = this.grounded
    this.grounded = hit && this.jumpLock <= 0 && (this.kind !== 'heli' || v.y < 0.8)

    if (this.grounded) {
      const n = this.ray.hitNormalWorld
      this.normal.set(n.x, n.y, n.z)
      const gb = this.ray.body
      if (gb && gb.type === CANNON.Body.KINEMATIC) this.groundVel.copy(gb.velocity)
      else this.groundVel.set(0, 0, 0)
      if (!wasGrounded && this.airTime > 0.2) this.on.land(this.airTime, Math.max(0, -this.lastVy))
      this.airTime = 0
      this.coyote = 0.12
      this.lastGroundY = b.position.y
    } else {
      this.airTime += dt
      this.coyote = Math.max(0, this.coyote - dt)
    }

    if (this.crashed && this.crashTimer <= 0 && (this.grounded || this.kind === 'heli')) {
      this.crashed = false
      this.on.recover()
    }

    const can = enabled && !this.crashed
    this.lifting = false
    if (this.kind === 'heli') this.stepHeli(dt, input, can)
    else this.stepWheels(dt, input, can)
    this.lastVy = v.y
  }

  /** Bikes and the flying car while on the ground; the car also flies here. */
  stepWheels(dt, input, can) {
    const P = this.P
    const v = this.body.velocity
    const isCar = this.kind === 'car'
    const steer = can ? input.steer : 0
    const absSpeed = Math.abs(this.speed)
    const turnRate = (P.TURN * Math.min(1, 0.45 + absSpeed / 5)) / (1 + absSpeed * 0.04)
    const airTurn = isCar ? 0.9 : 0.55
    const dYaw = -steer * turnRate * dt * (this.grounded ? 1 : airTurn)
    this.yaw += dYaw
    const sy = Math.sin(this.yaw)
    const cy = Math.cos(this.yaw)
    this.accelerating = can && input.accel
    const wantLift = isCar && can && input.lift

    if (this.grounded) {
      if (isCar) this.energy = Math.min(1, this.energy + P.RECHARGE * dt)
      const n = this.normal
      const gv = this.groundVel
      const vx = v.x - gv.x
      const vy = v.y - gv.y
      const vz = v.z - gv.z

      const d = sy * n.x + cy * n.z
      let fx = sy - n.x * d
      let fy = -n.y * d
      let fz = cy - n.z * d
      const fl = Math.hypot(fx, fy, fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl
      const rx = fy * n.z - fz * n.y
      const ry = fz * n.x - fx * n.z
      const rz = fx * n.y - fy * n.x

      let fs = vx * fx + vy * fy + vz * fz
      let ls = vx * rx + vy * ry + vz * rz
      const ns = vx * n.x + vy * n.y + vz * n.z

      if (can) {
        if (input.accel) {
          fs += (fs < 0 ? P.BRAKE : P.ACCEL * Math.max(0, 1 - fs / P.MAX_SPEED)) * dt
        }
        if (input.brake) {
          if (fs > 0.1) fs = Math.max(0, fs - P.BRAKE * dt)
          else fs = Math.max(-P.REVERSE, fs - 4 * dt)
        }
      } else {
        fs *= Math.exp(-(this.crashed ? 5 : 1.5) * dt)
      }
      const drag = can && input.accel ? P.ROLL_DRAG : P.ROLL_DRAG + P.COAST_DRAG
      fs -= fs * drag * dt
      ls *= Math.exp(-P.GRIP * dt)

      v.x = gv.x + fx * fs + rx * ls + n.x * ns
      v.y = gv.y + fy * fs + ry * ls + n.y * ns
      v.z = gv.z + fz * fs + rz * ls + n.z * ns
      this.speed = fs

      if (wantLift && this.energy > 0.08) {
        // thrusters: leave the ground
        v.y = Math.max(v.y, 0) + 3.6
        this.jumpLock = 0.25
        this.grounded = false
        this.lifting = true
        this.on.takeoff()
      } else if (!isCar && can && this.jumpBuffer > 0) this.doJump()
    } else if (isCar) {
      // flying car: points where it flies, thrusters while Lift is held, wings glide otherwise
      let fs = v.x * sy + v.z * cy
      let ls = v.z * sy - v.x * cy
      ls *= Math.exp(-2.5 * dt)
      if (can) {
        if (input.accel) fs += P.ACCEL * 0.7 * Math.max(0, 1 - fs / P.AIR_MAX) * dt
        if (input.brake) fs = Math.max(0, fs - P.BRAKE * 0.4 * dt)
      }
      fs -= fs * 0.05 * dt
      v.x = sy * fs - cy * ls
      v.z = cy * fs + sy * ls
      this.speed = fs
      if (wantLift && this.energy > 0) {
        this.lifting = true
        this.energy = Math.max(0, this.energy - dt / P.ENERGY)
        if (this.body.position.y < this.ceiling) v.y = Math.min(P.MAX_RISE, v.y + P.THRUST * dt)
      } else if (can && v.y < 0) {
        v.y += ANTI_GRAVITY * P.GLIDE * dt
        v.y = Math.max(v.y, -P.MAX_SINK)
      }
    } else {
      const a = dYaw * 0.7
      const c = Math.cos(a)
      const s = Math.sin(a)
      const vx = v.x * c + v.z * s
      const vz = v.z * c - v.x * s
      v.x = vx
      v.z = vz
      if (can && this.jumpBuffer > 0 && this.coyote > 0) this.doJump()
      this.speed = vx * sy + vz * cy
    }
  }

  /** Helicopter: hover by default, forward/back with throttle, Up/Down for altitude. */
  stepHeli(dt, input, can) {
    const P = this.P
    const v = this.body.velocity
    const steer = can ? input.steer : 0
    const dYaw = -steer * P.TURN * dt
    this.yaw += dYaw
    const sy = Math.sin(this.yaw)
    const cy = Math.cos(this.yaw)
    this.accelerating = can && input.accel

    let fs = v.x * sy + v.z * cy
    let ls = v.z * sy - v.x * cy
    if (can) {
      if (input.accel) fs += (fs < 0 ? P.BRAKE : P.ACCEL * Math.max(0, 1 - fs / P.MAX_SPEED)) * dt
      else if (input.brake) fs = fs > 0.1 ? Math.max(0, fs - P.BRAKE * dt) : Math.max(-P.REVERSE, fs - 3 * dt)
      else fs *= Math.exp(-0.7 * dt)
    } else fs *= Math.exp(-1.2 * dt)
    ls *= Math.exp(-3 * dt)
    v.x = sy * fs - cy * ls
    v.z = cy * fs + sy * ls
    this.speed = fs

    if (!can) {
      // rotor stalled after a crash: drops, but slower than a free fall
      v.y += ANTI_GRAVITY * 0.45 * dt
      return
    }
    let target = 0
    if (input.lift) target = P.CLIMB
    else if (input.down) target = -P.DESCEND
    if (this.body.position.y > this.ceiling && target > 0) target = 0
    this.lifting = target > 0
    if (this.lifting && this.grounded) {
      this.jumpLock = 0.2
      this.grounded = false
      this.on.takeoff()
    }
    v.y += (target - v.y) * (1 - Math.exp(-4 * dt))
    v.y += ANTI_GRAVITY * dt
  }

  doJump() {
    const v = this.body.velocity
    v.y = Math.max(v.y, 0) + this.P.JUMP
    this.jumpLock = 0.18
    this.jumpBuffer = 0
    this.coyote = 0
    this.grounded = false
    this.on.jump()
  }

  endStep() {
    const p = this.body.position
    this.pos.set(p.x, p.y, p.z)
    if (this.pendingCrash > 0 && !this.crashed) {
      this.crashed = true
      this.crashTimer = 1.4
      this.crashSide = Math.random() < 0.5 ? -1 : 1
      this.on.crash(this.pendingCrash)
    }
    this.pendingCrash = 0
  }
}
