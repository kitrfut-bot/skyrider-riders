/**
 * Multiplayer networking over PeerJS (WebRTC data channels).
 *
 * Topology: one host, everyone else connects to the host (star). The host owns the room:
 * it accepts or denies players, starts the race, relays everybody's rider state ~12 times a
 * second and decides when the race ends. Players are ghosts to each other (no collisions).
 *
 * Room code = the last part of the host's PeerJS id, so joining needs no server of our own.
 */

import { cleanVehicle } from './vehicles.js'
import { cleanRider } from './riders.js'

export const MP = {
  MAX_PLAYERS: 10,
  PROTO: 2,
  CHAT_MAX: 80,
  PREFIX: 'skyrider2-',
  SEND_HZ: 12,
  // Public STUN only. Strict mobile networks may also need a TURN relay: the old free public
  // TURN credentials no longer work, so add your own here (for example a free Metered account):
  //   { urls: 'turn:YOUR_HOST:443', username: '...', credential: '...' }
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  // Use your own PeerJS server instead of the free cloud one: { host, port, path, secure }
  PEER_SERVER: null,
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function randomCode() {
  let s = ''
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

export function cleanName(n) {
  const s = String(n || '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12)
  return s || 'Rider'
}

export function cleanChat(t) {
  return String(t || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MP.CHAT_MAX)
}

export function cleanCode(c) {
  return String(c || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)
}

/** Turns any error from PeerJS or this module into text a player can act on. */
export function describeError(e) {
  const t = e && (e.type || e.reason)
  if (t === 'peer-unavailable') return 'Room not found. Check the code and try again.'
  if (t === 'bad-code') return 'Enter the 5 character room code.'
  if (t === 'denied') {
    if (e.reason === 'full') return 'This room is full.'
    if (e.reason === 'started') return 'That race has already started. Ask the host to bring everyone back to the lobby.'
    if (e.reason === 'version') return 'The host runs a different version of the game.'
    return 'The host did not let you in.'
  }
  if (t === 'unavailable-id') return 'Could not create a room right now. Try again.'
  if (t === 'closed') return 'The host closed the connection.'
  if (t === 'offline') return 'You are offline. Solo rides still work, online rooms need internet.'
  if (t === 'timeout') return 'Could not connect. Check your internet and the room code.'
  if (['network', 'server-error', 'socket-error', 'socket-closed', 'ssl-unavailable'].includes(t)) {
    return 'Could not reach the multiplayer server. Check your internet.'
  }
  if (t === 'webrtc') return 'Connection failed. Your networks may block direct connections.'
  if (t === 'browser-incompatible') return 'This device does not support online play.'
  if (t === 'load') return 'Online play could not load.'
  return 'Something went wrong. Try again.'
}

let PeerCtor = null
async function loadPeer() {
  if (!PeerCtor) {
    try {
      const m = await import('peerjs')
      PeerCtor = m.Peer || m.default
    } catch (e) {
      throw { type: 'load' }
    }
  }
  return PeerCtor
}

function safeSend(conn, msg) {
  try {
    if (conn && conn.open) conn.send(msg)
  } catch (e) {
    /* connection is going away */
  }
}

export class Net {
  constructor() {
    /** callbacks: lobby(players), start(), snap(states), end(results, byPid), toLobby(), closed(text), playerLeft(pid), chat(msg) */
    this.on = {}
    this.resetState()
  }

  resetState() {
    this.peer = null
    this.hostConn = null
    this.conns = new Map() // host only: pid -> DataConnection
    this.isHost = false
    this.active = false
    this.pid = -1
    this.code = ''
    this.players = [] // [{ pid, name }]
    this.phase = 'idle' // idle | lobby | race | results
    this.states = new Map() // host only: pid -> latest rider state array
    this.finished = new Map() // host only: pid -> finish time
    this.seen = new Map() // host only: pid -> last time we heard from them
    this.hostSeen = 0
    this.raceNo = 0
    this.timers = []
    this.snapTimer = null
    this.reconnects = 0
    this._joinReject = null
    this.chatAt = new Map() // host only: pid -> last chat time (flood guard)
    this.vehicle = 'road'
    this.rider = 'classic'
  }

  // ---------- room setup ----------

  openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
      const opts = { debug: 1, config: { iceServers: MP.ICE_SERVERS }, ...(MP.PEER_SERVER || {}) }
      const peer = id ? new Peer(id, opts) : new Peer(opts)
      let settled = false
      const fail = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          peer.destroy()
        } catch (e) {
          /* already gone */
        }
        reject(err)
      }
      const timer = setTimeout(() => fail({ type: 'timeout' }), 12000)
      peer.on('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.peer = peer
        resolve(peer)
      })
      peer.on('error', (err) => {
        if (!settled) fail(err)
        else this.peerError(err)
      })
      peer.on('disconnected', () => this.peerDisconnected(peer))
    })
  }

  peerError(err) {
    if (err && err.type === 'peer-unavailable' && this._joinReject) this._joinReject(err)
  }

  /** Lost the signalling server. Open connections keep working, but new players cannot find the room, so reconnect. */
  peerDisconnected(peer) {
    if (!this.active || peer !== this.peer || peer.destroyed || this.reconnects > 8) return
    this.reconnects++
    setTimeout(() => {
      try {
        if (this.active && peer === this.peer && !peer.destroyed) peer.reconnect()
      } catch (e) {
        /* try again on the next disconnect event */
      }
    }, 1500)
  }

  async createRoom(name, vehicle, rider) {
    this.leaveSilently()
    this.vehicle = cleanVehicle(vehicle)
    this.rider = cleanRider(rider)
    const Peer = await loadPeer()
    let code = ''
    let lastErr = null
    for (let i = 0; i < 6 && !code; i++) {
      const c = randomCode()
      try {
        await this.openPeer(Peer, MP.PREFIX + c)
        code = c
      } catch (e) {
        lastErr = e
        if (!e || e.type !== 'unavailable-id') throw e
      }
    }
    if (!code) throw lastErr || { type: 'unavailable-id' }
    this.isHost = true
    this.active = true
    this.pid = 0
    this.code = code
    this.players = [{ pid: 0, name: cleanName(name), veh: this.vehicle, rider: this.rider, ready: true }]
    this.phase = 'lobby'
    this.peer.on('connection', (conn) => this.hostAccept(conn))
    this.startTimers()
    return code
  }

  async joinRoom(rawCode, name, vehicle, rider) {
    const code = cleanCode(rawCode)
    if (code.length < 5) throw { type: 'bad-code' }
    this.leaveSilently()
    this.vehicle = cleanVehicle(vehicle)
    this.rider = cleanRider(rider)
    try {
      const Peer = await loadPeer()
      await this.openPeer(Peer, null)
      const conn = this.peer.connect(MP.PREFIX + code, { reliable: true, serialization: 'json' })
      this.hostConn = conn
      let joined = false
      const welcome = await new Promise((resolve, reject) => {
        let done = false
        const finish = (fn, v) => {
          if (done) return
          done = true
          clearTimeout(t)
          this._joinReject = null
          fn(v)
        }
        const t = setTimeout(() => finish(reject, { type: 'timeout' }), 15000)
        this._joinReject = (err) => finish(reject, err)
        conn.on('open', () => safeSend(conn, { t: 'hi', name: cleanName(name), v: MP.PROTO, veh: this.vehicle, rider: this.rider }))
        conn.on('data', (msg) => {
          if (!joined) {
            if (msg && msg.t === 'welcome') {
              joined = true
              finish(resolve, msg)
            } else if (msg && msg.t === 'deny') finish(reject, { type: 'denied', reason: msg.reason })
          } else this.clientData(msg)
        })
        conn.on('error', (e) => finish(reject, e))
        conn.on('close', () => {
          if (!joined) finish(reject, { type: 'closed' })
          else this.hostLost('Lost connection to the host')
        })
      })
      this.isHost = false
      this.active = true
      this.pid = welcome.pid
      this.code = code
      this.players = welcome.players || []
      this.phase = welcome.phase || 'lobby'
      this.hostSeen = performance.now()
      this.startTimers()
    } catch (e) {
      this.leaveSilently()
      throw e
    }
  }

  // ---------- host side ----------

  hostAccept(conn) {
    let pid = -1
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return
      if (pid < 0) {
        if (msg.t !== 'hi') return
        if (msg.v !== MP.PROTO) return this.deny(conn, 'version')
        if (this.phase !== 'lobby') return this.deny(conn, 'started')
        if (this.players.length >= MP.MAX_PLAYERS) return this.deny(conn, 'full')
        pid = this.freePid()
        const name = this.uniqueName(cleanName(msg.name))
        this.players.push({ pid, name, veh: cleanVehicle(msg.veh), rider: cleanRider(msg.rider), ready: false })
        this.conns.set(pid, conn)
        this.seen.set(pid, performance.now())
        safeSend(conn, { t: 'welcome', pid, players: this.players, phase: this.phase })
        this.broadcastLobby()
        if (this.on.lobby) this.on.lobby(this.players, this.phase)
        return
      }
      this.seen.set(pid, performance.now())
      this.hostData(pid, msg)
    })
    const gone = () => {
      if (pid >= 0 && this.conns.get(pid) === conn) this.removePlayer(pid)
    }
    conn.on('close', gone)
    conn.on('error', gone)
  }

  deny(conn, reason) {
    safeSend(conn, { t: 'deny', reason })
    setTimeout(() => {
      try {
        conn.close()
      } catch (e) {
        /* ignore */
      }
    }, 400)
  }

  freePid() {
    for (let i = 1; i < MP.MAX_PLAYERS; i++) if (!this.players.some((p) => p.pid === i)) return i
    return MP.MAX_PLAYERS
  }

  uniqueName(name) {
    let n = name
    let k = 2
    while (this.players.some((p) => p.name.toLowerCase() === n.toLowerCase())) n = `${name.slice(0, 10)} ${k++}`
    return n
  }

  hostData(pid, msg) {
    switch (msg.t) {
      case 's':
        if (this.phase === 'race' && Array.isArray(msg.a)) this.states.set(pid, msg.a)
        break
      case 'fin':
        if (typeof msg.time === 'number' && msg.time > 0) this.handleFinish(pid, msg.time)
        break
      case 'veh':
        if (this.phase === 'lobby') this.updatePlayer(pid, { veh: cleanVehicle(msg.v), ready: false })
        break
      case 'rider':
        if (this.phase === 'lobby') this.updatePlayer(pid, { rider: cleanRider(msg.r) })
        break
      case 'ready':
        if (this.phase === 'lobby') this.updatePlayer(pid, { ready: !!msg.on })
        break
      case 'chat':
        this.relayChat(pid, msg.text)
        break
      case 'bye':
        this.removePlayer(pid)
        break
      default:
        break // ping and unknown messages only count as "still here"
    }
  }

  updatePlayer(pid, patch) {
    const p = this.players.find((x) => x.pid === pid)
    if (!p) return
    let changed = false
    for (const [k, v] of Object.entries(patch)) {
      if (p[k] !== v) {
        p[k] = v
        changed = true
      }
    }
    if (!changed) return
    this.broadcastLobby()
    if (this.on.lobby) this.on.lobby(this.players, this.phase)
  }

  /** Host: pass a chat line on to everybody (including ourselves), at most 2 lines a second per rider. */
  relayChat(pid, raw) {
    const text = cleanChat(raw)
    if (!text) return
    const now = performance.now()
    if (now - (this.chatAt.get(pid) || 0) < 500) return
    this.chatAt.set(pid, now)
    const who = this.players.find((p) => p.pid === pid)
    if (!who) return
    const msg = { t: 'chat', pid, name: who.name, text }
    this.broadcast(msg)
    if (this.on.chat) this.on.chat(msg)
  }

  /** Host only: remove a rider from the room. */
  kick(pid) {
    if (!this.isHost || pid === 0) return
    const conn = this.conns.get(pid)
    if (!conn) return
    safeSend(conn, { t: 'kicked' })
    this.conns.delete(pid)
    setTimeout(() => {
      try {
        conn.close()
      } catch (e) {
        /* ignore */
      }
    }, 300)
    this.removePlayer(pid)
  }

  removePlayer(pid) {
    const conn = this.conns.get(pid)
    this.conns.delete(pid)
    this.states.delete(pid)
    this.seen.delete(pid)
    this.chatAt.delete(pid)
    try {
      if (conn) conn.close()
    } catch (e) {
      /* ignore */
    }
    const who = this.players.find((p) => p.pid === pid)
    if (!who) return
    this.players = this.players.filter((p) => p.pid !== pid)
    if (this.on.playerLeft) this.on.playerLeft(pid, who.name)
    this.broadcastLobby()
    if (this.on.lobby) this.on.lobby(this.players, this.phase)
  }

  broadcast(msg) {
    for (const conn of this.conns.values()) safeSend(conn, msg)
  }

  broadcastLobby() {
    this.broadcast({ t: 'lobby', players: this.players })
  }

  startRace() {
    if (!this.isHost || this.phase !== 'lobby' || this.players.length < 2 || !this.players.every((p) => p.ready)) return false
    this.phase = 'race'
    this.raceNo++
    this.finished.clear()
    this.states.clear()
    this.broadcast({ t: 'start', n: this.raceNo })
    this.snapTimer = setInterval(() => this.sendSnapshot(), 1000 / MP.SEND_HZ)
    if (this.on.start) this.on.start()
    return true
  }

  sendSnapshot() {
    if (this.phase !== 'race') return
    const p = {}
    for (const [pid, arr] of this.states) p[pid] = arr
    this.broadcast({ t: 'snap', p })
    if (this.on.snap) this.on.snap(p)
  }

  handleFinish(pid, time) {
    if (this.phase !== 'race' || this.finished.has(pid)) return
    this.finished.set(pid, time)
    this.endRace(pid)
  }

  /** First rider across the line ends the race for everybody. Finishers rank by time, the rest by distance covered. */
  endRace(byPid) {
    if (this.snapTimer) clearInterval(this.snapTimer)
    this.snapTimer = null
    const res = this.players.map((p) => {
      const st = this.states.get(p.pid)
      const time = this.finished.has(p.pid) ? this.finished.get(p.pid) : null
      return { pid: p.pid, name: p.name, veh: p.veh, time, pg: st ? Number(st[13]) || 0 : 0 }
    })
    res.sort((a, b) => {
      if (a.time != null && b.time != null) return a.time - b.time
      if (a.time != null) return -1
      if (b.time != null) return 1
      return b.pg - a.pg
    })
    this.phase = 'results'
    this.broadcast({ t: 'end', res, by: byPid })
    if (this.on.end) this.on.end(res, byPid)
  }

  /** Host only: bring everybody back to the lobby for another race. */
  backToLobby() {
    if (!this.isHost || (this.phase !== 'results' && this.phase !== 'race')) return
    if (this.snapTimer) clearInterval(this.snapTimer)
    this.snapTimer = null
    this.phase = 'lobby'
    for (const p of this.players) p.ready = p.pid === 0
    this.broadcast({ t: 'toLobby' })
    this.broadcastLobby()
    if (this.on.toLobby) this.on.toLobby()
    if (this.on.lobby) this.on.lobby(this.players, this.phase)
  }

  // ---------- client side ----------

  clientData(msg) {
    if (!msg || typeof msg !== 'object') return
    this.hostSeen = performance.now()
    switch (msg.t) {
      case 'lobby':
        if (Array.isArray(msg.players)) {
          this.players = msg.players
          if (this.on.lobby) this.on.lobby(this.players, this.phase)
        }
        break
      case 'start':
        this.phase = 'race'
        if (this.on.start) this.on.start()
        break
      case 'snap':
        if (this.on.snap && msg.p) this.on.snap(msg.p)
        break
      case 'end':
        this.phase = 'results'
        if (this.on.end) this.on.end(msg.res || [], msg.by)
        break
      case 'toLobby':
        this.phase = 'lobby'
        if (this.on.toLobby) this.on.toLobby()
        break
      case 'chat':
        if (this.on.chat && typeof msg.text === 'string') {
          this.on.chat({ pid: Number(msg.pid), name: cleanName(msg.name), text: cleanChat(msg.text) })
        }
        break
      case 'kicked':
        this.hostLost('The host removed you from the room.')
        break
      case 'bye':
        this.hostLost('The host closed the room.')
        break
      default:
        break
    }
  }

  hostLost(text) {
    const was = this.active
    this.leaveSilently()
    if (was && this.on.closed) this.on.closed(text)
  }

  // ---------- shared ----------

  /** Rider state, called by the game a few times a second while racing. */
  sendState(arr) {
    if (!this.active || this.phase !== 'race') return
    if (this.isHost) this.states.set(0, arr)
    else safeSend(this.hostConn, { t: 's', a: arr })
  }

  /** Change our vehicle while in the lobby. */
  setVehicle(id) {
    this.vehicle = cleanVehicle(id)
    if (!this.active || this.phase !== 'lobby') return
    if (this.isHost) this.updatePlayer(0, { veh: this.vehicle })
    else {
      const me = this.me
      if (me) {
        me.veh = this.vehicle
        me.ready = false
      }
      safeSend(this.hostConn, { t: 'veh', v: this.vehicle })
    }
  }

  /** Change our rider while in the lobby. Looks only, so it does not reset the ready mark. */
  setRider(id) {
    this.rider = cleanRider(id)
    if (!this.active || this.phase !== 'lobby') return
    if (this.isHost) this.updatePlayer(0, { rider: this.rider })
    else {
      const me = this.me
      if (me) me.rider = this.rider
      safeSend(this.hostConn, { t: 'rider', r: this.rider })
    }
  }

  setReady(on) {
    if (!this.active || this.isHost || this.phase !== 'lobby') return
    const me = this.me
    if (me) me.ready = !!on
    safeSend(this.hostConn, { t: 'ready', on: !!on })
  }

  sendChat(text) {
    const t = cleanChat(text)
    if (!this.active || !t) return
    if (this.isHost) this.relayChat(0, t)
    else safeSend(this.hostConn, { t: 'chat', text: t })
  }

  get me() {
    return this.players.find((p) => p.pid === this.pid) || null
  }

  localFinished(time) {
    if (!this.active) return
    if (this.isHost) this.handleFinish(0, time)
    else safeSend(this.hostConn, { t: 'fin', time })
  }

  startTimers() {
    this.timers.push(setInterval(() => this.tick(), 2000))
  }

  tick() {
    const now = performance.now()
    if (this.isHost) {
      this.broadcast({ t: 'hb' })
      for (const pid of [...this.conns.keys()]) {
        if (now - (this.seen.get(pid) || now) > 10000) this.removePlayer(pid)
      }
    } else {
      safeSend(this.hostConn, { t: 'ping' })
      if (now - this.hostSeen > 12000) this.hostLost('Lost connection to the host.')
    }
  }

  /** Leave on purpose (button). */
  leave() {
    if (this.active) {
      if (this.isHost) this.broadcast({ t: 'bye' })
      else safeSend(this.hostConn, { t: 'bye' })
    }
    this.leaveSilently(true)
  }

  leaveSilently(delayed = false) {
    for (const t of this.timers) clearInterval(t)
    if (this.snapTimer) clearInterval(this.snapTimer)
    const peer = this.peer
    const conns = [...this.conns.values()]
    const hostConn = this.hostConn
    this.resetState()
    const close = () => {
      try {
        for (const c of conns) c.close()
        if (hostConn) hostConn.close()
        if (peer) peer.destroy()
      } catch (e) {
        /* already closed */
      }
    }
    // give the goodbye message a moment to leave before the connection is torn down
    if (delayed) setTimeout(close, 250)
    else close()
  }
}
