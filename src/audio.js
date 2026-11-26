import { STORAGE } from './constants.js'

/** All sounds are synthesized with WebAudio, so nothing needs to be downloaded. */
export class Sound {
  constructor() {
    this.ctx = null
    this.muted = safeGet(STORAGE.MUTED) === '1'
    this.kind = 'bike'
  }

  init() {
    if (this.ctx) {
      this.resume()
      return
    }
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = (this.ctx = new AC())
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.8
    this.master.connect(ctx.destination)

    const len = ctx.sampleRate * 2
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1

    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = 'bandpass'
    this.windFilter.frequency.value = 400
    this.windFilter.Q.value = 0.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master)
    wind.start()

    const rumble = ctx.createBufferSource()
    rumble.buffer = this.noise
    rumble.loop = true
    rumble.playbackRate.value = 0.7
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 160
    this.rumbleGain = ctx.createGain()
    this.rumbleGain.gain.value = 0
    rumble.connect(lp).connect(this.rumbleGain).connect(this.master)
    rumble.start()

    // flying car engine / thrusters: a low buzzing saw plus filtered noise
    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineOsc.frequency.value = 70
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.frequency.value = 500
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master)
    this.engineOsc.start()

    const jet = ctx.createBufferSource()
    jet.buffer = this.noise
    jet.loop = true
    const jetF = ctx.createBiquadFilter()
    jetF.type = 'bandpass'
    jetF.frequency.value = 1400
    jetF.Q.value = 0.5
    this.jetGain = ctx.createGain()
    this.jetGain.gain.value = 0
    jet.connect(jetF).connect(this.jetGain).connect(this.master)
    jet.start()

    // helicopter rotor: noise chopped by a low-frequency oscillator
    const rotor = ctx.createBufferSource()
    rotor.buffer = this.noise
    rotor.loop = true
    rotor.playbackRate.value = 0.5
    const rotF = ctx.createBiquadFilter()
    rotF.type = 'lowpass'
    rotF.frequency.value = 420
    this.chop = ctx.createGain()
    this.chop.gain.value = 0.5
    this.rotorLfo = ctx.createOscillator()
    this.rotorLfo.type = 'square'
    this.rotorLfo.frequency.value = 12
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.5
    this.rotorLfo.connect(lfoDepth).connect(this.chop.gain)
    this.rotorLfo.start()
    this.rotorGain = ctx.createGain()
    this.rotorGain.gain.value = 0
    rotor.connect(rotF).connect(this.chop).connect(this.rotorGain).connect(this.master)
    rotor.start()
  }

  /** Which engine loops play: 'bike' (none), 'car' or 'heli'. */
  setKind(kind) {
    this.kind = kind
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {})
  }

  setMuted(m) {
    this.muted = m
    safeSet(STORAGE.MUTED, m ? '1' : '0')
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05)
  }

  update(speed, grounded, falling, lift = false, running = true) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const sp = Math.min(1, Math.abs(speed) / 18)
    const windTarget = 0.03 + sp * 0.32 + (falling ? 0.35 : 0)
    this.windFilter.frequency.setTargetAtTime(260 + sp * 900 + (falling ? 700 : 0), t, 0.2)
    this.windGain.gain.setTargetAtTime(windTarget, t, 0.25)
    this.rumbleGain.gain.setTargetAtTime(grounded && this.kind !== 'heli' ? sp * 0.45 : 0, t, 0.06)

    const car = this.kind === 'car' && running
    const heli = this.kind === 'heli' && running
    this.engineOsc.frequency.setTargetAtTime(car ? 55 + sp * 90 + (lift ? 35 : 0) : 95 + (lift ? 20 : 0), t, 0.12)
    this.engineFilter.frequency.setTargetAtTime(car ? 380 + sp * 900 : 300, t, 0.15)
    this.engineGain.gain.setTargetAtTime(car ? 0.045 + sp * 0.05 : heli ? 0.02 : 0, t, 0.1)
    this.jetGain.gain.setTargetAtTime(car && lift ? 0.28 : 0, t, lift ? 0.04 : 0.12)
    this.rotorLfo.frequency.setTargetAtTime(heli ? 11 + sp * 4 + (lift ? 2.5 : 0) : 6, t, 0.3)
    this.rotorGain.gain.setTargetAtTime(heli ? 0.32 + (lift ? 0.1 : 0) : 0, t, 0.2)
  }

  silenceLoops() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.windGain.gain.setTargetAtTime(0.03, t, 0.1)
    this.rumbleGain.gain.setTargetAtTime(0, t, 0.05)
    this.engineGain.gain.setTargetAtTime(0, t, 0.1)
    this.jetGain.gain.setTargetAtTime(0, t, 0.1)
    this.rotorGain.gain.setTargetAtTime(0, t, 0.2)
  }

  takeoff() {
    this.burst({ dur: 0.35, type: 'bandpass', freq: 600, freqEnd: 1800, gain: 0.25 })
  }

  burst({ dur = 0.1, type = 'lowpass', freq = 1000, freqEnd, q = 0.8, gain = 0.3, delay = 0 }) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = type
    f.Q.value = q
    f.frequency.setValueAtTime(freq, t)
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
  }

  tone({ type = 'sine', f0 = 440, f1, dur = 0.2, gain = 0.2, delay = 0 }) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(f0, t)
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  pedalTick() {
    this.burst({ dur: 0.035, type: 'highpass', freq: 3800, gain: 0.09 })
    this.tone({ type: 'square', f0: 2100, dur: 0.018, gain: 0.015 })
  }

  jump() {
    this.tone({ type: 'triangle', f0: 240, f1: 640, dur: 0.18, gain: 0.22 })
    this.burst({ dur: 0.14, type: 'bandpass', freq: 900, gain: 0.12 })
  }

  land(intensity) {
    const k = Math.min(1, intensity / 18)
    this.burst({ dur: 0.16, type: 'lowpass', freq: 500, freqEnd: 120, gain: 0.15 + k * 0.4 })
    this.tone({ type: 'sine', f0: 110, f1: 50, dur: 0.15, gain: 0.1 + k * 0.25 })
  }

  bump() {
    this.burst({ dur: 0.12, type: 'bandpass', freq: 380, q: 1.2, gain: 0.3 })
  }

  crash() {
    this.burst({ dur: 0.7, type: 'lowpass', freq: 1600, freqEnd: 120, gain: 0.85 })
    this.tone({ type: 'sine', f0: 130, f1: 38, dur: 0.45, gain: 0.6 })
    this.tone({ type: 'square', f0: 460, f1: 300, dur: 0.14, gain: 0.1 })
    this.tone({ type: 'square', f0: 820, f1: 700, dur: 0.1, gain: 0.06, delay: 0.08 })
  }

  fall() {
    this.tone({ type: 'sine', f0: 600, f1: 120, dur: 0.6, gain: 0.15 })
  }

  checkpoint() {
    this.tone({ type: 'sine', f0: 660, dur: 0.16, gain: 0.25 })
    this.tone({ type: 'sine', f0: 990, dur: 0.3, gain: 0.25, delay: 0.12 })
  }

  beep(high) {
    this.tone({ type: 'square', f0: high ? 880 : 440, dur: high ? 0.4 : 0.15, gain: 0.12 })
  }

  finish() {
    ;[523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.22, delay: i * 0.12 }))
  }
}

export function safeGet(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable (private mode) */
  }
}
