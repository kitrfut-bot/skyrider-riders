import * as THREE from 'three'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()

export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Third-person chase camera with speed-based FOV and trauma-driven shake. */
export class CameraRig {
  constructor(camera) {
    this.camera = camera
    this.pos = new THREE.Vector3()
    this.look = new THREE.Vector3()
    this.yaw = 0
    this.trauma = 0
    this.time = 0
    this.fov = camera.fov
    // chase distance and height multipliers per vehicle (bigger rides sit further back)
    this.profile = { dist: 1, height: 1 }
  }

  setProfile(kind) {
    this.profile = kind === 'heli' ? { dist: 1.45, height: 1.5 } : kind === 'car' ? { dist: 1.2, height: 1.1 } : { dist: 1, height: 1 }
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  snap(target, yaw) {
    this.yaw = yaw
    this.pos.set(target.x - Math.sin(yaw) * 5.4, target.y + 2.4, target.z - Math.cos(yaw) * 5.4)
    this.look.set(target.x + Math.sin(yaw) * 2.5, target.y + 1.1, target.z + Math.cos(yaw) * 2.5)
    this.trauma = 0
  }

  update(dt, target, yaw, speed, falling) {
    this.time += dt
    const sp = Math.abs(speed)
    this.yaw = lerpAngle(this.yaw, yaw, 1 - Math.exp(-3.8 * dt))
    const fx = Math.sin(this.yaw)
    const fz = Math.cos(this.yaw)
    const dist = (5.2 + sp * 0.07) * this.profile.dist
    const height = (2.2 + sp * 0.035) * this.profile.height

    if (!falling) {
      _desired.set(target.x - fx * dist, target.y + height, target.z - fz * dist)
      const k = 1 - Math.exp(-7 * dt)
      this.pos.x += (_desired.x - this.pos.x) * k
      this.pos.z += (_desired.z - this.pos.z) * k
      this.pos.y += (_desired.y - this.pos.y) * (1 - Math.exp(-5 * dt))
    }

    _look.set(target.x + fx * 2.5, target.y + 1.1, target.z + fz * 2.5)
    if (falling) _look.copy(target)
    this.look.lerp(_look, 1 - Math.exp(-(falling ? 4 : 12) * dt))

    this.trauma = Math.max(0, this.trauma - dt * 1.3)
    const s = this.trauma * this.trauma
    const t = this.time
    const cam = this.camera
    cam.position.set(
      this.pos.x + s * 0.55 * (Math.sin(t * 37.1) + Math.sin(t * 23.7) * 0.5),
      this.pos.y + s * 0.45 * (Math.sin(t * 41.3 + 1.7) + Math.sin(t * 19.1) * 0.5),
      this.pos.z + s * 0.55 * Math.sin(t * 31.9 + 3.1),
    )
    cam.lookAt(this.look)
    cam.rotateZ(s * 0.06 * Math.sin(t * 29.3))

    const targetFov = 62 + Math.min(sp, 22) * 0.55
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-3 * dt))
    if (Math.abs(cam.fov - this.fov) > 0.05) {
      cam.fov = this.fov
      cam.updateProjectionMatrix()
    }
  }

  orbit(dt, center, dist = 8.5, height = 3.2, speed = 0.18, lookY = 0.9) {
    this.time += dt
    const a = this.time * speed
    const cam = this.camera
    cam.position.set(center.x + Math.sin(a) * dist, center.y + height, center.z + Math.cos(a) * dist)
    cam.lookAt(center.x, center.y + lookY, center.z)
    if (Math.abs(cam.fov - 62) > 0.05) {
      cam.fov = this.fov = 62
      cam.updateProjectionMatrix()
    }
  }
}
