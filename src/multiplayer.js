import { Net, MP, cleanName, cleanCode, cleanChat, describeError } from './net.js'
import { Remotes, colorOf, encodeState } from './remotes.js'
import { safeGet, safeSet } from './audio.js'
import { formatTime } from './hud.js'
import { STORAGE } from './constants.js'
import { getVehicle, vehicleIcon } from './vehicles.js'

const $ = (id) => document.getElementById(id)

/**
 * Glue between the network layer (net.js), the other riders (remotes.js), the lobby screens and the game.
 * The game itself (main.js) only gets small callbacks: beginRace, raceEnded, toLobby, toMenu, setPalette, toast.
 */
export class Multiplayer {
  constructor({ scene, screens, showScreen, courseLength, cb, getSelectedVehicle, getSelectedRider }) {
    this.net = new Net()
    this.remotes = new Remotes(scene)
    this.screens = screens
    this.showScreen = showScreen
    this.courseLength = courseLength
    this.cb = cb
    this.getSelectedVehicle = getSelectedVehicle || (() => 'road')
    this.getSelectedRider = getSelectedRider || (() => 'classic')
    this.sendAcc = 0
    this.busy = false
    this.view = 'join' // the lobby side of the main menu: 'join' (create or join) or 'room'

    this.el = {
      menu: screens.menu,
      joinView: $('lobby-join'),
      roomView: $('lobby-room'),
      soloNote: $('solo-note'),
      play: $('btn-play'),
      ready: $('btn-ready'),
      share: $('btn-share'),
      chatLog: $('chat-log'),
      chatForm: $('chat-form'),
      chatInput: $('chat-input'),
      netPill: $('net-pill'),
      name: $('mp-name'),
      code: $('mp-code'),
      status: $('mp-status'),
      create: $('btn-create'),
      join: $('btn-join'),
      roomCode: $('room-code'),
      copy: $('btn-copy'),
      list: $('lobby-list'),
      count: $('lobby-count'),
      lobbyStatus: $('lobby-status'),
      start: $('btn-start-mp'),
      resultsTitle: $('results-title'),
      resultsList: $('results-list'),
      resultsStatus: $('results-status'),
      backToLobby: $('btn-lobby-again'),
    }

    this.el.name.value = cleanName(safeGet(STORAGE.NAME) || `Rider${1000 + Math.floor(Math.random() * 9000)}`)
    this.el.code.addEventListener('input', () => {
      this.el.code.value = cleanCode(this.el.code.value)
    })
    this.el.create.addEventListener('click', () => this.create())
    this.el.join.addEventListener('click', () => this.join())
    this.el.code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join()
    })
    this.el.copy.addEventListener('click', () => this.copyCode())
    this.el.start.addEventListener('click', () => this.net.startRace())
    this.el.ready.addEventListener('click', () => this.toggleReady())
    this.el.share.addEventListener('click', () => this.shareRoom())
    this.el.chatForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = cleanChat(this.el.chatInput.value)
      if (!text) return
      this.net.sendChat(text)
      this.el.chatInput.value = ''
    })
    this.el.share.hidden = typeof navigator.share !== 'function'
    this.updateNetwork()
    window.addEventListener('online', () => this.updateNetwork())
    window.addEventListener('offline', () => this.updateNetwork())
    this.el.backToLobby.addEventListener('click', () => this.net.backToLobby())
    $('btn-leave-lobby').addEventListener('click', () => this.leave())
    $('btn-leave-results').addEventListener('click', () => this.leave())

    const net = this.net
    net.on.lobby = (players) => {
      this.remotes.sync(players, net.pid)
      if (this.view === 'room') this.renderLobby()
    }
    net.on.playerLeft = (pid, name) => {
      this.remotes.remove(pid)
      this.cb.toast(`${name} left`)
    }
    net.on.chat = (msg) => this.appendChat(msg)
    net.on.start = () => {
      this.remotes.resetForRace()
      this.cb.beginRace()
    }
    net.on.snap = (p) => this.remotes.setSnapshot(p, net.pid, performance.now())
    net.on.end = (res) => {
      this.cb.raceEnded()
      this.showResults(res)
    }
    net.on.toLobby = () => {
      this.remotes.resetForRace()
      this.cb.toLobby()
      this.setView('room')
      this.showScreen(this.screens.menu)
    }
    net.on.closed = (text) => {
      this.remotes.clear()
      this.cb.setPalette(null)
      this.cb.toMenu()
      this.openMenu(text)
    }
  }

  get active() {
    return this.net.active
  }

  get racing() {
    return this.net.active && this.net.phase === 'race'
  }

  setStatus(text, bad = false) {
    this.el.status.textContent = text || ''
    this.el.status.classList.toggle('bad', bad)
  }

  setBusy(on, text) {
    this.busy = on
    this.el.create.disabled = on || navigator.onLine === false
    this.el.join.disabled = on || navigator.onLine === false
    if (on) this.setStatus(text)
  }

  /** Show the join/create side of the lobby in the main menu, optionally with a message. */
  openMenu(message = '') {
    this.updateNetwork()
    this.setView('join')
    this.setStatus(message, !!message)
    this.showScreen(this.screens.menu)
  }

  /** Switch the lobby panel inside the main menu between create/join and the room. */
  setView(view) {
    this.view = view
    const inRoom = view === 'room'
    if (inRoom) this.renderLobby()
    this.el.joinView.hidden = inRoom
    this.el.roomView.hidden = !inRoom
    this.el.soloNote.hidden = !inRoom
    this.el.play.hidden = inRoom
  }

  /** Make the lobby panel match the network state (used whenever the menu is shown again). */
  syncMenu() {
    this.setView(this.net.active ? 'room' : 'join')
  }

  playerName() {
    const n = cleanName(this.el.name.value)
    this.el.name.value = n
    safeSet(STORAGE.NAME, n)
    return n
  }

  async create() {
    if (this.busy) return
    this.cb.userGesture()
    this.setBusy(true, 'Creating room...')
    try {
      await this.net.createRoom(this.playerName(), this.getSelectedVehicle(), this.getSelectedRider())
      this.enterLobby()
    } catch (e) {
      this.setStatus(describeError(e), true)
    } finally {
      this.setBusy(false)
    }
  }

  async join() {
    if (this.busy) return
    this.cb.userGesture()
    const code = cleanCode(this.el.code.value)
    if (code.length < 5) {
      this.setStatus(describeError({ type: 'bad-code' }), true)
      return
    }
    this.setBusy(true, 'Joining room...')
    try {
      await this.net.joinRoom(code, this.playerName(), this.getSelectedVehicle(), this.getSelectedRider())
      this.enterLobby()
    } catch (e) {
      this.setStatus(describeError(e), true)
    } finally {
      this.setBusy(false)
    }
  }

  enterLobby() {
    this.el.chatLog.replaceChildren()
    this.el.chatInput.value = ''
    this.setStatus('')
    this.cb.setPalette(this.net.pid)
    this.remotes.sync(this.net.players, this.net.pid)
    this.setView('room')
    this.showScreen(this.screens.menu)
  }

  renderLobby() {
    const net = this.net
    this.el.roomCode.textContent = net.code
    this.el.roomCode.setAttribute('aria-label', `Room code ${net.code}`)
    this.el.count.textContent = `${net.players.length} / ${MP.MAX_PLAYERS} riders`
    this.fillRoster(this.el.list, net.players)
    const host = net.isHost
    const me = net.me
    const allReady = net.players.length >= 2 && net.players.every((p) => p.ready)
    this.el.start.hidden = !host
    this.el.start.disabled = !allReady
    this.el.ready.hidden = host
    this.el.ready.disabled = !me
    this.el.ready.setAttribute('aria-pressed', String(!!me?.ready))
    this.el.ready.classList.toggle('is-ready', !!me?.ready)
    this.el.ready.textContent = me?.ready ? 'Ready ✓' : "I'm ready"
    this.el.lobbyStatus.textContent = host
      ? net.players.length < 2
        ? 'Share the room code. Invite at least one rider to start.'
        : allReady
          ? 'Everyone is ready. Start the race when you are.'
          : `${net.players.filter((p) => !p.ready).map((p) => p.name).join(', ')} ${net.players.filter((p) => !p.ready).length === 1 ? 'is' : 'are'} choosing a vehicle.`
      : me?.ready
        ? 'You are ready. Change your vehicle in the garage to choose again.'
        : 'Pick a vehicle in the garage, then tap “I’m ready”.'
  }

  /** Guests can change vehicle until ready; selecting a new one resets their ready mark. */
  vehicleChanged(id) {
    if (!this.net.active || this.net.phase !== 'lobby') return
    this.net.setVehicle(id)
    this.remotes.sync(this.net.players, this.net.pid)
    this.renderLobby()
  }

  /** Rider looks can change any time in the lobby without un-readying. */
  riderChanged(id) {
    if (!this.net.active || this.net.phase !== 'lobby') return
    this.net.setRider(id)
    this.remotes.sync(this.net.players, this.net.pid)
  }

  toggleReady() {
    const me = this.net.me
    if (!me || this.net.isHost || this.net.phase !== 'lobby') return
    this.net.setReady(!me.ready)
    this.renderLobby()
  }

  updateNetwork() {
    const online = navigator.onLine !== false
    this.el.netPill.textContent = online ? 'Online' : 'Offline'
    this.el.netPill.classList.toggle('offline', !online)
    this.el.create.disabled = this.busy || !online
    this.el.join.disabled = this.busy || !online
    if (!online) this.setStatus('Offline. Solo rides still work; online rooms need an internet connection.')
    else if (this.el.status.textContent.startsWith('Offline.')) this.setStatus('')
  }

  appendChat(raw) {
    const text = cleanChat(raw.text)
    if (!text) return
    const li = document.createElement('li')
    const who = document.createElement('strong')
    who.textContent = raw.pid === this.net.pid ? 'You' : cleanName(raw.name)
    const body = document.createElement('span')
    body.textContent = `: ${text}`
    li.append(who, body)
    this.el.chatLog.append(li)
    while (this.el.chatLog.children.length > 30) this.el.chatLog.firstElementChild.remove()
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight
  }

  async shareRoom() {
    if (!this.net.code || typeof navigator.share !== 'function') return
    try {
      await navigator.share({ title: 'Sky Rider room', text: `Join my Sky Rider race. Room code: ${this.net.code}` })
    } catch (e) {
      /* Share sheet dismissed. */
    }
  }
  fillRoster(list, players) {
    list.replaceChildren()
    for (const p of players) {
      const li = document.createElement('li')
      if (p.pid === this.net.pid) li.classList.add('me')
      const name = document.createElement('span')
      name.className = 'rname'
      name.textContent = p.name
      const ride = getVehicle(p.veh || 'road')
      const vehicle = document.createElement('span')
      vehicle.className = 'roster-vehicle'
      vehicle.innerHTML = vehicleIcon(ride.id, 18)
      vehicle.title = ride.name
      vehicle.setAttribute('aria-label', ride.name)
      const ready = document.createElement('span')
      ready.className = `ready-tag${p.ready ? ' ready' : ''}`
      ready.textContent = p.ready ? 'Ready' : 'Choosing'
      const tags = []
      if (p.pid === 0) tags.push('Host')
      else if (p.pid === this.net.pid) tags.push('You')
      li.append(vehicle, name, ready)
      if (tags.length) {
        const t = document.createElement('span')
        t.className = 'tag'
        t.textContent = tags.join(' ')
        li.append(t)
      }
      if (this.net.isHost && p.pid !== 0) {
        const kick = document.createElement('button')
        kick.type = 'button'
        kick.className = 'kick-btn'
        kick.textContent = 'Remove'
        kick.setAttribute('aria-label', `Remove ${p.name} from room`)
        kick.addEventListener('click', () => {
          if (window.confirm(`Remove ${p.name} from the room?`)) this.net.kick(p.pid)
        })
        li.append(kick)
      }
      list.append(li)
    }
  }
  async copyCode() {
    const code = this.net.code
    let ok = false
    try {
      await navigator.clipboard.writeText(code)
      ok = true
    } catch (e) {
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.append(ta)
        ta.select()
        ok = document.execCommand('copy')
        ta.remove()
      } catch (e2) {
        ok = false
      }
    }
    this.el.copy.textContent = ok ? 'Copied' : code
    setTimeout(() => {
      this.el.copy.textContent = 'Copy'
    }, 1600)
  }

  showResults(res) {
    const net = this.net
    const winner = res[0]
    const iWon = winner && winner.time != null && winner.pid === net.pid
    this.el.resultsTitle.textContent = !winner ? 'Race over' : iWon ? 'You won!' : `${winner.name} wins!`
    const list = this.el.resultsList
    list.replaceChildren()
    res.forEach((r, i) => {
      const li = document.createElement('li')
      if (r.pid === net.pid) li.className = 'me'
      const rank = document.createElement('span')
      rank.className = 'rank'
      rank.textContent = String(i + 1)
      const vehicle = document.createElement('span')
      vehicle.className = 'roster-vehicle'
      const ride = getVehicle(r.veh || 'road')
      vehicle.innerHTML = vehicleIcon(ride.id, 18)
      vehicle.setAttribute('aria-label', ride.name)
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.style.background = colorOf(r.pid)
      const name = document.createElement('span')
      name.className = 'rname'
      name.textContent = r.name
      const val = document.createElement('span')
      val.className = 'tag'
      if (r.time != null) val.textContent = formatTime(r.time)
      else val.textContent = `${Math.max(0, Math.min(99, Math.round((r.pg / this.courseLength) * 100)))}%`
      li.append(rank, dot, vehicle, name, val)
      list.append(li)
    })
    this.el.backToLobby.hidden = !net.isHost
    this.el.resultsStatus.textContent = net.isHost ? '' : 'Waiting for the host to start another race...'
    this.showScreen(this.screens.results)
  }

  leave() {
    this.net.leave()
    this.remotes.clear()
    this.cb.setPalette(null)
    this.setStatus('')
    this.cb.toMenu()
  }

  /** Called every frame while racing: sends our state ~12 times a second. */
  sendState(dt, makeState) {
    if (!this.racing) return
    this.sendAcc += dt
    if (this.sendAcc < 1 / MP.SEND_HZ) return
    this.sendAcc = 0
    this.net.sendState(encodeState(makeState()))
  }

  localFinished(time) {
    this.net.localFinished(time)
  }

  update(dt, camera) {
    if (this.net.active) this.remotes.update(dt, camera, performance.now())
  }

  /** [rank, total] for the HUD. */
  rank(progress, finished) {
    return this.remotes.rank(progress, finished)
  }
}
