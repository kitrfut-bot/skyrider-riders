const STICK_RADIUS = 56
const DEADZONE = 0.1

/** Multi-touch joystick + buttons, with a keyboard fallback for desktop testing. */
export class Controls {
  constructor() {
    this.layer = document.getElementById('touch')
    this.base = document.getElementById('stick-base')
    this.knob = document.getElementById('stick-knob')
    this.buttons = [...this.layer.querySelectorAll('[data-btn]')]

    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }
    this.btnPointers = new Map()
    this.pressed = new Set()
    this.keys = new Set()
    this.keySteer = 0
    this.vehicleKind = 'bike'

    this.onJump = () => {}
    this.onPause = () => {}

    this.layer.addEventListener('pointerdown', (e) => this.pointerDown(e))
    this.layer.addEventListener('pointermove', (e) => this.move(e))
    this.layer.addEventListener('pointerup', (e) => this.up(e))
    this.layer.addEventListener('pointercancel', (e) => this.up(e))
    this.layer.addEventListener('lostpointercapture', (e) => this.up(e))
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => this.keyDown(e))
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.reset())
  }

  pointerDown(e) {
    if (e.target.closest('.pause-btn')) return
    e.preventDefault()
    try {
      this.layer.setPointerCapture(e.pointerId)
    } catch {
      /* capture not supported */
    }
    const btn = e.target.closest('[data-btn]')
    if (btn) {
      this.btnPointers.set(e.pointerId, btn.dataset.btn)
      this.refresh()
    } else if (e.clientX < window.innerWidth * 0.5 && this.stick.id === null) {
      const s = this.stick
      s.id = e.pointerId
      s.ox = e.clientX
      s.oy = e.clientY
      s.x = 0
      s.y = 0
      this.base.classList.add('active')
      this.base.style.left = `${e.clientX}px`
      this.base.style.top = `${e.clientY}px`
      this.knob.style.transform = 'translate(-50%, -50%)'
    } else {
      this.btnPointers.set(e.pointerId, null)
    }
  }

  move(e) {
    const s = this.stick
    if (e.pointerId === s.id) {
      let dx = e.clientX - s.ox
      let dy = e.clientY - s.oy
      const len = Math.hypot(dx, dy)
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS
        dy = (dy / len) * STICK_RADIUS
      }
      s.x = shape(dx / STICK_RADIUS)
      s.y = shape(dy / STICK_RADIUS)
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    } else if (this.btnPointers.has(e.pointerId)) {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const btn = el && el.closest ? el.closest('[data-btn]') : null
      const name = btn ? btn.dataset.btn : null
      if (this.btnPointers.get(e.pointerId) !== name) {
        this.btnPointers.set(e.pointerId, name)
        this.refresh()
      }
    }
  }

  up(e) {
    if (e.pointerId === this.stick.id) {
      this.releaseStick()
    } else if (this.btnPointers.has(e.pointerId)) {
      this.btnPointers.delete(e.pointerId)
      this.refresh()
    }
  }

  releaseStick() {
    const s = this.stick
    s.id = null
    s.x = 0
    s.y = 0
    this.base.classList.remove('active')
    this.base.style.left = ''
    this.base.style.top = ''
    this.knob.style.transform = 'translate(-50%, -50%)'
  }

  refresh() {
    const next = new Set()
    for (const name of this.btnPointers.values()) if (name) next.add(name)
    if (next.has('jump') && !this.pressed.has('jump')) this.onJump()
    this.pressed = next
    for (const b of this.buttons) b.classList.toggle('on', next.has(b.dataset.btn))
  }

  keyDown(e) {
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onPause()
      return
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    if (e.code === 'Space' && !e.repeat) this.onJump()
    this.keys.add(e.code)
  }

  update(dt) {
    const k = this.keys
    const target = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0)
    const rate = target === 0 ? 10 : 6
    this.keySteer += (target - this.keySteer) * Math.min(1, rate * dt)
    if (Math.abs(this.keySteer) < 0.001) this.keySteer = 0
  }

  get steer() {
    const v = this.stick.id !== null ? this.stick.x : this.keySteer
    return Math.max(-1, Math.min(1, v))
  }

  get accel() {
    return this.pressed.has('accel') || this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.stick.y < -0.6
  }

  /** Held Jump button / Space: thrusters on the flying car, climb on the helicopter. */
  setKind(kind) {
    this.vehicleKind = kind
  }

  get lift() {
    return this.pressed.has('jump') || this.keys.has('Space') ||
      (this.vehicleKind === 'heli' && (this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.stick.y < -0.65))
  }

  /** Helicopter descend: Down button, Shift, C or Q. */
  get down() {
    const k = this.keys
    return this.pressed.has('down') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC') || k.has('KeyQ') ||
      (this.vehicleKind === 'heli' && (k.has('ArrowDown') || k.has('KeyS') || this.stick.y > 0.65))
  }

  get brake() {
    return this.pressed.has('brake') || this.keys.has('ArrowDown') || this.keys.has('KeyS') || this.stick.y > 0.65
  }

  reset() {
    this.releaseStick()
    this.btnPointers.clear()
    this.keys.clear()
    this.keySteer = 0
    this.refresh()
  }
}

function shape(v) {
  const a = Math.abs(v)
  if (a < DEADZONE) return 0
  return Math.sign(v) * Math.pow((a - DEADZONE) / (1 - DEADZONE), 1.35)
}
