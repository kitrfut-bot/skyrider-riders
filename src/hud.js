export function formatTime(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const d = Math.floor((t * 10) % 10)
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}

/** Updates DOM text only when the displayed value changes to avoid layout work every frame. */
export class Hud {
  constructor(totalLength) {
    this.root = document.getElementById('hud')
    this.speedEl = document.querySelector('#hud-speed .val')
    this.timeEl = document.querySelector('#hud-time .val')
    this.distEl = document.querySelector('#hud-dist .val')
    this.totalEl = document.querySelector('#hud-dist .unit')
    this.cpEl = document.querySelector('#hud-cp .val')
    this.barEl = document.getElementById('hud-progress-fill')
    this.toastEl = document.getElementById('toast')
    this.countEl = document.getElementById('countdown')
    this.total = Math.round(totalLength)
    this.totalEl.textContent = `/ ${this.total} m`
    this.last = { speed: -1, time: '', dist: -1, cp: '' }
    this.toastTimer = 0
  }

  show(v) {
    this.root.hidden = !v
  }

  update(speedKmh, time, dist, cpText) {
    const sp = Math.round(speedKmh)
    if (sp !== this.last.speed) {
      this.last.speed = sp
      this.speedEl.textContent = String(sp)
    }
    const ts = formatTime(time)
    if (ts !== this.last.time) {
      this.last.time = ts
      this.timeEl.textContent = ts
    }
    const d = Math.max(0, Math.min(this.total, Math.round(dist)))
    if (d !== this.last.dist) {
      this.last.dist = d
      this.distEl.textContent = String(d)
      this.barEl.style.transform = `scaleX(${d / this.total})`
    }
    if (cpText !== this.last.cp) {
      this.last.cp = cpText
      this.cpEl.textContent = cpText
    }
  }

  toast(text) {
    const el = this.toastEl
    el.textContent = text
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
  }

  countdown(text) {
    const el = this.countEl
    if (!text) {
      el.classList.remove('show')
      return
    }
    el.textContent = text
    el.classList.remove('show')
    void el.offsetWidth
    el.classList.add('show')
  }
}
