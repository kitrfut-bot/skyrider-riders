import * as THREE from 'three'
import { createVehicleModel, KIND_LOOK } from './vehicleModels.js'
import { getVehicle } from './vehicles.js'
import { cleanRider } from './riders.js'

const V3 = THREE.Vector3

/** One colour set per player slot. Slot 0 is the original red bike. Same slot = same colour on every screen. */
export const PALETTES = [
  null,
  { frame: '#2d8cff', jersey: '#ffffff', helmet: '#2d8cff' },
  { frame: '#27c46b', jersey: '#1b2a41', helmet: '#27c46b' },
  { frame: '#ff8a1f', jersey: '#ffffff', helmet: '#ff8a1f' },
  { frame: '#ff5fa2', jersey: '#2b2d42', helmet: '#ff5fa2' },
  { frame: '#12c2c2', jersey: '#f4f4f4', helmet: '#12c2c2' },
  { frame: '#ffd23f', jersey: '#d62839', helmet: '#ffd23f' },
  { frame: '#2a2d34', jersey: '#f2f2f2', helmet: '#2a2d34' },
  { frame: '#9be02a', jersey: '#23252e', helmet: '#9be02a' },
  { frame: '#7fd1ff', jersey: '#c0392b', helmet: '#7fd1ff' },
]

export function paletteFor(pid) {
  const p = PALETTES[pid % PALETTES.length]
  if (!p) return null
  const dark = new THREE.Color(p.jersey).multiplyScalar(0.82)
  return { ...p, jerseyDark: `#${dark.getHexString()}` }
}

export function colorOf(pid) {
  const p = PALETTES[pid % PALETTES.length]
  return p ? p.frame : '#ff3d57'
}

// ---------- state packet ----------
// [x, y, z, yaw, speed, vy, grounded, crash(-1/0/1), steer, nx, nz, pedaling, checkpoint, progress, finished, lift]

const r2 = (v) => Math.round(v * 100) / 100

export function encodeState(s) {
  return [
    r2(s.x),
    r2(s.y),
    r2(s.z),
    r2(s.yaw),
    r2(s.speed),
    r2(s.vy),
    s.grounded ? 1 : 0,
    s.crashed ? (s.crashSide >= 0 ? 1 : -1) : 0,
    r2(s.steer),
    r2(s.nx),
    r2(s.nz),
    s.pedaling ? 1 : 0,
    s.cp | 0,
    Math.round(s.progress),
    s.finished ? 1 : 0,
    s.lift ? 1 : 0,
  ]
}

function num(v, lo, hi, fallback = 0) {
  v = Number(v)
  if (!Number.isFinite(v)) return fallback
  return Math.max(lo, Math.min(hi, v))
}

export function decodeState(a) {
  if (!Array.isArray(a) || a.length < 15) return null
  return {
    x: num(a[0], -5000, 5000),
    y: num(a[1], -2000, 2000),
    z: num(a[2], -5000, 5000),
    yaw: num(a[3], -100, 100),
    speed: num(a[4], -60, 60),
    vy: num(a[5], -100, 100),
    grounded: a[6] === 1,
    crash: num(a[7], -1, 1),
    steer: num(a[8], -1, 1),
    nx: num(a[9], -1, 1),
    nz: num(a[10], -1, 1),
    pedaling: a[11] === 1,
    cp: num(a[12], 0, 999),
    progress: num(a[13], 0, 100000),
    finished: a[14] === 1,
    lift: a[15] === 1,
  }
}

// ---------- name label ----------

function makeLabel(name, color) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(10, 32, 64, 0.72)'
  g.beginPath()
  if (g.roundRect) g.roundRect(4, 8, 248, 48, 24)
  else g.rect(4, 8, 248, 48)
  g.fill()
  g.fillStyle = color
  g.beginPath()
  g.arc(32, 32, 11, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = '600 28px Fredoka, system-ui, sans-serif'
  g.textAlign = 'left'
  g.textBaseline = 'middle'
  g.fillText(name, 52, 34, 190)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false })
  const sprite = new THREE.Sprite(mat)
  sprite.renderOrder = 6
  return sprite
}

export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    const m = o.material
    if (m) {
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (mm.map) mm.map.dispose()
        mm.dispose()
      }
    }
  })
}

const _tmp = new V3()

class Remote {
  constructor(pid, name, veh, rider, scene) {
    this.pid = pid
    this.name = name
    this.veh = veh
    this.rider = rider
    this.look = KIND_LOOK[getVehicle(veh).kind]
    this.scene = scene
    this.model = createVehicleModel(veh, paletteFor(pid), rider)
    this.model.root.visible = false
    scene.add(this.model.root)
    this.label = makeLabel(name, colorOf(pid))
    this.label.visible = false
    scene.add(this.label)

    this.has = false
    this.lastRecv = 0
    this.pos = new V3()
    this.target = new V3()
    this.vel = new V3()
    this.yaw = 0
    this.targetYaw = 0
    this.normal = new V3(0, 1, 0)
    this.targetNormal = new V3(0, 1, 0)
    this.progress = 0
    this.cp = 0
    this.finished = false
    this.st = {
      pos: this.pos,
      yaw: 0,
      normal: this.normal,
      grounded: true,
      speed: 0,
      steer: 0,
      pedaling: false,
      crashed: false,
      crashSide: 1,
      vy: 0,
      hSpeed: 0,
      lift: false,
      active: true,
    }
  }

  dispose() {
    this.scene.remove(this.model.root)
    this.scene.remove(this.label)
    disposeObject(this.model.root)
    disposeObject(this.label)
  }
}

/** All other riders in the room: creates their ghost vehicles and keeps them moving smoothly between network updates. */
export class Remotes {
  constructor(scene) {
    this.scene = scene
    this.map = new Map()
  }

  /** Make the set of ghost bikes match the room roster. */
  sync(players, localPid) {
    const want = new Set()
    for (const p of players) {
      if (p.pid === localPid) continue
      want.add(p.pid)
      const have = this.map.get(p.pid)
      if (have && (have.name !== p.name || have.veh !== (p.veh || 'road') || have.rider !== cleanRider(p.rider))) {
        have.dispose()
        this.map.delete(p.pid)
      }
      if (!this.map.has(p.pid)) this.map.set(p.pid, new Remote(p.pid, p.name, p.veh || 'road', cleanRider(p.rider), this.scene))
    }
    for (const pid of [...this.map.keys()]) if (!want.has(pid)) this.remove(pid)
  }

  remove(pid) {
    const r = this.map.get(pid)
    if (r) r.dispose()
    this.map.delete(pid)
  }

  clear() {
    for (const r of this.map.values()) r.dispose()
    this.map.clear()
  }

  /** Hide everyone until the next race sends fresh positions. */
  resetForRace() {
    for (const r of this.map.values()) {
      r.has = false
      r.progress = 0
      r.cp = 0
      r.finished = false
      r.model.root.visible = false
      r.label.visible = false
    }
  }

  setSnapshot(p, localPid, now) {
    for (const key of Object.keys(p)) {
      const pid = Number(key)
      if (pid === localPid) continue
      const r = this.map.get(pid)
      if (!r) continue
      const d = decodeState(p[key])
      if (!d) continue
      _tmp.set(d.x, d.y, d.z)
      if (!r.has || _tmp.distanceTo(r.target) > 10) {
        r.pos.copy(_tmp)
        r.target.copy(_tmp)
        r.vel.set(0, 0, 0)
        r.yaw = d.yaw
        r.has = true
      } else {
        const dt = Math.max(0.04, (now - r.lastRecv) / 1000)
        const v = _tmp.clone().sub(r.target).divideScalar(dt)
        if (v.length() > 40) v.setLength(40)
        r.vel.lerp(v, 0.5)
        r.target.copy(_tmp)
      }
      r.lastRecv = now
      r.targetYaw = d.yaw
      const ny2 = 1 - d.nx * d.nx - d.nz * d.nz
      r.targetNormal.set(d.nx, Math.sqrt(Math.max(0.05, ny2)), d.nz).normalize()
      const st = r.st
      st.grounded = d.grounded
      st.crashed = d.crash !== 0
      st.crashSide = d.crash >= 0 ? 1 : -1
      st.pedaling = d.pedaling
      st.vy = d.vy
      st.lift = d.lift
      r.speedTarget = d.speed
      r.steerTarget = d.steer
      r.progress = d.progress
      r.cp = d.cp
      r.finished = d.finished
    }
  }

  update(dt, camera, now) {
    const k = 1 - Math.exp(-12 * dt)
    for (const r of this.map.values()) {
      if (!r.has) continue
      const age = Math.min(0.25, (now - r.lastRecv) / 1000)
      _tmp.copy(r.target).addScaledVector(r.vel, age)
      r.pos.lerp(_tmp, k)
      let dy = r.targetYaw - r.yaw
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      r.yaw += dy * k
      r.normal.lerp(r.targetNormal, k).normalize()
      const st = r.st
      st.yaw = r.yaw
      st.speed += ((r.speedTarget || 0) - st.speed) * k
      st.steer += ((r.steerTarget || 0) - st.steer) * k
      st.hSpeed = Math.abs(st.speed)
      r.model.root.visible = true
      r.model.update(dt, st)

      const dist = camera.position.distanceTo(r.pos)
      const s = Math.max(0.45, Math.min(9, dist * 0.045))
      r.label.visible = dist > 4
      r.label.position.set(r.pos.x, r.pos.y + r.look.label + s * 0.3, r.pos.z)
      r.label.scale.set(s * 4, s, 1)
    }
  }

  /** [rank, total] for the local rider. Finished riders come first, the rest by distance along the course. */
  rank(localProgress, localFinished) {
    let ahead = 0
    let total = 1
    for (const r of this.map.values()) {
      if (!r.has) {
        total++
        continue
      }
      total++
      if ((r.finished && !localFinished) || (r.finished === localFinished && r.progress > localProgress + 0.5)) ahead++
    }
    return [ahead + 1, total]
  }
}
