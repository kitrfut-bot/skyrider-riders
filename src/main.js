import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/fredoka/latin-700.css'
import './style.css'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PHYS, STORAGE } from './constants.js'
import { Course } from './course.js'
import { Environment } from './environment.js'
import { VehicleController } from './vehicleController.js'
import { createVehicleModel } from './vehicleModels.js'
import { cleanVehicle, getVehicle, PAINTS, BUTTON_LABELS, vehicleIcon } from './vehicles.js'
import { Garage } from './garage.js'
import { Multiplayer } from './multiplayer.js'
import { paletteFor, disposeObject } from './remotes.js'
import { cleanRider } from './riders.js'
import { CameraRig } from './cameraRig.js'
import { Controls } from './controls.js'
import { Sound, safeGet, safeSet } from './audio.js'
import { Hud, formatTime } from './hud.js'
import { BillboardSet, syncSpriteLighting } from './sprites.js'

// Renderer
const canvas = document.getElementById('game')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false })
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 1.5)
let dpr = MAX_DPR
renderer.setPixelRatio(dpr)
renderer.setSize(window.innerWidth, window.innerHeight)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500)

// Physics
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, PHYS.GRAVITY, 0) })
world.broadphase = new CANNON.SAPBroadphase(world)
world.allowSleep = true
world.solver.iterations = 8
world.defaultContactMaterial.friction = 0
const groundMat = new CANNON.Material('ground')
const bikeMat = new CANNON.Material('bike')
const crateMat = new CANNON.Material('crate')
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, bikeMat, { friction: 0, restitution: 0 }))
world.addContactMaterial(new CANNON.ContactMaterial(groundMat, crateMat, { friction: 0.5, restitution: 0.1 }))
world.addContactMaterial(new CANNON.ContactMaterial(bikeMat, crateMat, { friction: 0.05, restitution: 0.25 }))
world.addContactMaterial(new CANNON.ContactMaterial(crateMat, crateMat, { friction: 0.5, restitution: 0.05 }))

// World
const course = new Course(scene, world, groundMat, crateMat)
course.build()
course.finalize()
const env = new Environment(scene, course)
syncSpriteLighting(scene) // sprites shade themselves with the scene's real sun and sky
for (const [name, list] of Object.entries(course.sprites)) {
  if (list.length) scene.add(new BillboardSet(name, list, { mode: 'cyl', anchor: 'bottom', fade: true }).mesh)
}
let vehicleId = cleanVehicle(safeGet(STORAGE.VEHICLE))
let paintIndex = Math.max(0, Math.min(PAINTS.length - 1, Number(safeGet(STORAGE.PAINT)) || 0))
let riderId = cleanRider(safeGet(STORAGE.RIDER))
let roomPid = null
let garage
const localPalette = () => ({ frame: PAINTS[paintIndex], helmet: PAINTS[paintIndex] })
const currentPalette = () => roomPid == null ? localPalette() : paletteFor(roomPid)
const bestKey = (id) => id === 'road' ? STORAGE.BEST : `${STORAGE.BEST}-${id}`
const readBest = (id) => Number(safeGet(bestKey(id))) || 0
const bike = new VehicleController(world, bikeMat)
bike.setVehicle(vehicleId)
bike.ceiling = course.maxY + 50
let model = createVehicleModel(vehicleId, currentPalette(), riderId)
scene.add(model.root)

function replaceModel() {
  scene.remove(model.root)
  disposeObject(model.root)
  model = createVehicleModel(vehicleId, currentPalette(), riderId)
  scene.add(model.root)
  model.update(1 / 60, renderState(1))
}

function syncRideLabel() {
  const spec = getVehicle(vehicleId)
  const icon = document.getElementById('ride-icon')
  icon.innerHTML = vehicleIcon(spec.id, 26)
  document.getElementById('ride-name').textContent = spec.name
  document.getElementById('ride-type').textContent = spec.type
  document.getElementById('ride-hint').textContent = spec.hint
}

function syncTouchLabels() {
  const spec = getVehicle(vehicleId)
  const labels = BUTTON_LABELS[spec.kind]
  document.getElementById('lbl-jump').textContent = labels.jump
  document.getElementById('tbtn-jump').setAttribute('aria-label', labels.jump)
  document.getElementById('lbl-accel').textContent = labels.accel
  document.getElementById('tbtn-accel').setAttribute('aria-label', labels.accel)
  document.getElementById('tbtn-down').hidden = spec.kind !== 'heli'
  document.getElementById('tbtn-brake').hidden = spec.kind === 'heli'
  const lines = spec.kind === 'bike'
    ? ['Touch: left thumb steers; right-side buttons pedal, brake and jump.', 'Keyboard: W / ↑ pedal, S / ↓ brake, A / D steer, Space jump, P pause.']
    : spec.kind === 'car'
      ? ['Touch: left thumb steers; hold Lift to fly, Drive to accelerate, Brake to slow.', 'Keyboard: W / ↑ drive, S / ↓ brake, A / D steer, hold Space to lift, P pause.']
      : ['Touch: left thumb steers; Fly moves forward, Up climbs, Down descends.', 'Keyboard: W / ↑ fly forward, A / D steer, hold Space / ↑ to climb, Shift / ↓ to descend, P pause.']
  const how = document.getElementById('how-list')
  how.replaceChildren(...lines.map((text) => {
    const li = document.createElement('li')
    li.textContent = text
    return li
  }))
}

function chooseVehicle(id, color = paintIndex) {
  const nextId = cleanVehicle(id)
  const nextPaint = Math.max(0, Math.min(PAINTS.length - 1, Number(color) || 0))
  const changed = nextId !== vehicleId || nextPaint !== paintIndex
  vehicleId = nextId
  paintIndex = nextPaint
  safeSet(STORAGE.VEHICLE, vehicleId)
  safeSet(STORAGE.PAINT, String(paintIndex))
  bike.setVehicle(vehicleId)
  bike.ceiling = course.maxY + 50
  game.best = readBest(vehicleId)
  sound.setKind(getVehicle(vehicleId).kind)
  controls.setKind(getVehicle(vehicleId).kind)
  rig.setProfile(getVehicle(vehicleId).kind)
  if (changed) replaceModel()
  syncRideLabel()
  syncTouchLabels()
  updateBestLabel()
  if (garage) garage.render()
}


const shadow = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false }),
  )
  mesh.renderOrder = 1
  scene.add(mesh)
  return mesh
})()

const rig = new CameraRig(camera)
const sound = new Sound()
const hud = new Hud(course.totalLength)
const controls = new Controls()
const cps = course.checkpoints
const checkpointCount = cps.filter((c) => c.kind === 'checkpoint').length

const ui = {
  menu: document.getElementById('screen-menu'),
  garage: document.getElementById('screen-garage'),
  pause: document.getElementById('screen-pause'),
  finish: document.getElementById('screen-finish'),
  results: document.getElementById('screen-results'),
  rank: document.getElementById('hud-rank'),
  rankVal: document.querySelector('#hud-rank .val'),
  btnLeaveRace: document.getElementById('btn-leave-race'),
  btnRestart: document.getElementById('btn-restart'),
  pauseNote: document.getElementById('pause-note'),
  touch: document.getElementById('touch'),
  fade: document.getElementById('fade'),
  best: document.getElementById('menu-best'),
  finishTime: document.getElementById('finish-time'),
  finishBest: document.getElementById('finish-best'),
  finishBadge: document.getElementById('finish-badge'),
  mute: document.getElementById('btn-mute'),
  alt: document.getElementById('hud-alt'),
  energy: document.getElementById('hud-energy'),
  energyFill: document.getElementById('hud-energy-fill'),
}

const game = {
  mode: 'single', // 'single' or 'multi'
  mpPaused: false, // multiplayer pause menu is open but the race keeps running
  lastRank: '',
  state: 'menu',
  resumeState: 'playing',
  time: 0,
  physTime: 0,
  acc: 0,
  cpIndex: 0,
  countdown: 0,
  countStep: -1,
  respawnTimer: 0,
  respawned: false,
  finishTimer: 0,
  progressIdx: 0,
  best: readBest(vehicleId),
}

// Events from bike physics
bike.on.jump = () => {
  sound.jump()
  model.popStand()
}
bike.on.land = (air, impact) => {
  sound.land(impact)
  if (impact > 9) rig.shake(Math.min(0.35, impact / 50))
}
bike.on.crash = (impact) => {
  sound.crash()
  rig.shake(Math.min(1, 0.6 + impact / 40))
  hud.toast('Crash!')
  if (navigator.vibrate) navigator.vibrate(120)
}
bike.on.bump = () => sound.bump()
bike.on.takeoff = () => sound.takeoff()

controls.onJump = () => {
  if (game.state === 'playing') bike.requestJump()
}
controls.onPause = () => {
  if (game.state === 'paused' || game.mpPaused) resume()
  else pause()
}

// State transitions
function updateBestLabel() {
  ui.best.textContent = game.best ? `${getVehicle(vehicleId).name} best ${formatTime(game.best)}` : `No ${getVehicle(vehicleId).name} best time yet`
}

function showScreen(el) {
  for (const s of [ui.menu, ui.garage, ui.pause, ui.finish, ui.results]) s.hidden = s !== el
}

function startRace(mode = 'single') {
  sound.init()
  game.mode = mode
  game.mpPaused = false
  game.lastRank = ''
  const multi = mode === 'multi'
  bike.setVehicle(vehicleId)
  sound.setKind(getVehicle(vehicleId).kind)
  ui.alt.hidden = getVehicle(vehicleId).kind === 'bike'
  ui.energy.hidden = getVehicle(vehicleId).id !== 'car'
  ui.rank.hidden = !multi
  ui.btnLeaveRace.hidden = !multi
  ui.btnRestart.hidden = multi
  ui.pauseNote.hidden = !multi
  ui.fade.classList.remove('on')
  course.reset()
  game.physTime = 0
  game.time = 0
  game.cpIndex = 0
  game.acc = 0
  game.progressIdx = 0
  game.respawnTimer = 0
  bike.reset(course.startSpawn, course.startYaw)
  rig.snap(bike.pos, course.startYaw)
  model.update(1 / 60, renderState(0))
  showScreen(null)
  hud.show(true)
  ui.touch.hidden = false
  controls.reset()
  game.state = 'countdown'
  game.countdown = 3.2
  game.countStep = -1
}

function pause() {
  if (game.state !== 'playing' && game.state !== 'countdown') return
  if (game.mode === 'multi') {
    // online races never stop: just open the menu
    game.mpPaused = true
    controls.reset()
    showScreen(ui.pause)
    return
  }
  game.resumeState = game.state
  game.state = 'paused'
  controls.reset()
  sound.suspend()
  showScreen(ui.pause)
}

function resume() {
  if (game.mode === 'multi') {
    if (!game.mpPaused) return
    game.mpPaused = false
    showScreen(null)
    return
  }
  if (game.state !== 'paused') return
  showScreen(null)
  sound.resume()
  game.state = game.resumeState
}

function finishRace() {
  game.state = 'finished'
  game.finishTimer = 1.3
  sound.finish()
  if (game.mode === 'multi') {
    // the host decides the result; the results screen opens when it arrives
    game.finishTimer = 0
    game.mpPaused = false
    ui.touch.hidden = true
    hud.toast('Finish!')
    mp.localFinished(game.time)
    return
  }
  const isBest = !game.best || game.time < game.best
  if (isBest) {
    game.best = game.time
    safeSet(bestKey(vehicleId), String(game.time))
  }
  ui.finishTime.textContent = formatTime(game.time)
  ui.finishBest.textContent = `Best ${formatTime(game.best)}`
  ui.finishBadge.hidden = !isBest
  hud.toast('Finish!')
}

function goFullscreen() {
  const el = document.documentElement
  if (document.fullscreenElement || !el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
    .catch(() => {})
}

document.getElementById('btn-play').addEventListener('click', () => {
  goFullscreen()
  startRace()
})
document.getElementById('btn-pause').addEventListener('click', (e) => {
  e.stopPropagation()
  pause()
})
document.getElementById('btn-resume').addEventListener('click', resume)
ui.btnRestart.addEventListener('click', () => startRace())
document.getElementById('btn-again').addEventListener('click', () => startRace())
ui.btnLeaveRace.addEventListener('click', () => mp.leave())
document.getElementById('btn-respawn').addEventListener('click', () => {
  resume()
  triggerRespawn()
})
function syncMuteLabel() {
  ui.mute.textContent = sound.muted ? 'Sound: Off' : 'Sound: On'
  ui.mute.setAttribute('aria-pressed', String(!sound.muted))
}
ui.mute.addEventListener('click', () => {
  sound.setMuted(!sound.muted)
  syncMuteLabel()
})
syncMuteLabel()
updateBestLabel()

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode !== 'multi') pause()
})
const portraitQuery = window.matchMedia('(orientation: portrait) and (pointer: coarse)')
portraitQuery.addEventListener('change', (e) => {
  if (e.matches && game.mode !== 'multi') pause()
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

function triggerRespawn() {
  if (game.respawnTimer > 0) return
  game.respawnTimer = 0.8
  game.respawned = false
  ui.fade.classList.add('on')
  sound.fall()
}

function doRespawn() {
  const cp = cps[game.cpIndex]
  bike.reset(cp.spawn, cp.yaw)
  rig.snap(bike.pos, cp.yaw)
  rig.shake(0.25)
  game.progressIdx = course.nearestIndex(cp.spawn)
  ui.fade.classList.remove('on')
  game.respawned = true
}

// Multiplayer
function localRiderState() {
  const n = bike.normal
  return {
    x: bike.pos.x,
    y: bike.pos.y,
    z: bike.pos.z,
    yaw: bike.yaw,
    speed: bike.speed,
    vy: bike.body.velocity.y,
    grounded: bike.grounded,
    crashed: bike.crashed,
    crashSide: bike.crashSide,
    steer: game.state === 'playing' ? controls.steer : 0,
    nx: n.x,
    nz: n.z,
    pedaling: bike.accelerating && bike.grounded,
    lift: bike.lifting,
    cp: game.cpIndex,
    progress: course.path[game.progressIdx].s,
    finished: game.state === 'finished',
  }
}

/** Same colour for a rider on every screen: our own bike takes the colour of our room slot. */
function setLocalPalette(pid) {
  roomPid = pid == null ? null : pid
  replaceModel()
  if (garage) garage.render()
}

function backToMenu() {
  game.mode = 'single'
  game.state = 'menu'
  game.mpPaused = false
  game.respawnTimer = 0
  hud.show(false)
  hud.countdown('')
  ui.touch.hidden = true
  ui.fade.classList.remove('on')
  controls.reset()
  bike.reset(course.startSpawn, course.startYaw)
  mp.syncMenu()
  showScreen(ui.menu)
}

function toLobbyState() {
  game.state = 'menu'
  game.mpPaused = false
  game.respawnTimer = 0
  hud.show(false)
  hud.countdown('')
  ui.touch.hidden = true
  ui.fade.classList.remove('on')
  controls.reset()
  bike.reset(course.startSpawn, course.startYaw)
}

function endMultiRace() {
  // first rider across the line ends the race for everybody
  if (game.state === 'playing' || game.state === 'countdown' || game.state === 'finished') {
    if (game.state !== 'finished') sound.beep(true)
    game.state = 'finished'
    game.finishTimer = 0
  }
  game.mpPaused = false
  hud.countdown('')
  hud.show(false)
  ui.touch.hidden = true
  ui.fade.classList.remove('on')
  controls.reset()
}

const mp = new Multiplayer({
  scene,
  screens: { menu: ui.menu, results: ui.results },
  showScreen,
  courseLength: course.totalLength,
  getSelectedVehicle: () => vehicleId,
  getSelectedRider: () => riderId,
  cb: {
    beginRace: () => startRace('multi'),
    raceEnded: endMultiRace,
    toLobby: toLobbyState,
    toMenu: backToMenu,
    setPalette: (pid) => {
      setLocalPalette(pid)
      garage?.setOnline(pid != null)
    },
    toast: (t) => hud.toast(t),
    userGesture: () => {
      goFullscreen()
      sound.init()
    },
  },
})

// Menu controls and garage. Vehicle choice is local; in a room it is also sent to the host.
garage = new Garage({
  vehicle: vehicleId,
  paint: paintIndex,
  rider: riderId,
  bestFor: (id) => readBest(id),
  onChange: (id, paint) => {
    const changedVehicle = id !== vehicleId
    const changedPaint = paint !== paintIndex
    chooseVehicle(id, paint)
    if (changedVehicle && mp.active && mp.net.phase === 'lobby') mp.vehicleChanged(vehicleId)
  },
  onRider: (id) => {
    riderId = cleanRider(id)
    safeSet(STORAGE.RIDER, riderId)
    replaceModel()
    if (mp.active && mp.net.phase === 'lobby') mp.riderChanged(riderId)
  },
})
garage.setOnline(false)
chooseVehicle(vehicleId, paintIndex)

document.getElementById('btn-garage').addEventListener('click', () => {
  if (game.state === 'menu') showScreen(ui.garage)
})
document.getElementById('btn-garage-done').addEventListener('click', () => {
  showScreen(ui.menu)
  mp.syncMenu()
})

// Frame loop
const renderPos = new THREE.Vector3()
const shadowRay = new CANNON.RaycastResult()
const rayFrom = new CANNON.Vec3()
const rayTo = new CANNON.Vec3()
const shadowNormal = new THREE.Vector3()
const ZUP = new THREE.Vector3(0, 0, 1)

function renderState(alpha) {
  renderPos.lerpVectors(bike.prevPos, bike.pos, alpha)
  const v = bike.body.velocity
  return {
    pos: renderPos,
    yaw: bike.prevYaw + (bike.yaw - bike.prevYaw) * alpha,
    normal: bike.normal,
    grounded: bike.grounded,
    speed: bike.speed,
    steer: game.state === 'playing' ? controls.steer : 0,
    pedaling: bike.accelerating && bike.grounded,
    lift: bike.lifting || (game.state === 'menu' && vehicleId === 'car'),
    active: game.state !== 'paused',
    energy: bike.energy,
    crashed: bike.crashed,
    crashSide: bike.crashSide,
    vy: v.y,
    hSpeed: Math.hypot(v.x, v.z),
  }
}

function fixedStep(dt) {
  const enabled = game.state === 'playing' && game.respawnTimer <= 0 && !game.mpPaused
  bike.beginStep()
  bike.step(dt, controls, enabled)
  course.update(dt, game.physTime)
  world.step(dt)
  game.physTime += dt
  bike.endStep()
}

function checkCheckpoints() {
  const p = bike.pos
  for (let i = game.cpIndex + 1; i < Math.min(cps.length, game.cpIndex + 3); i++) {
    const cp = cps[i]
    const dx = p.x - cp.center.x
    const dz = p.z - cp.center.z
    if (dx * dx + dz * dz < (cp.radius * 0.9) ** 2 && Math.abs(p.y - cp.center.y) < 4) {
      game.cpIndex = i
      course.setReached(cp, true)
      if (cp.kind === 'finish') finishRace()
      else {
        sound.checkpoint()
        hud.toast(`Checkpoint ${i}/${checkpointCount}`)
      }
      break
    }
  }
}

let perfAccum = 0
let perfFrames = 0
function adaptQuality(dt) {
  perfAccum += dt
  perfFrames++
  if (perfAccum < 2) return
  const avg = perfAccum / perfFrames
  perfAccum = 0
  perfFrames = 0
  if (avg > 1 / 50 && dpr > 0.8) {
    dpr = Math.max(0.75, dpr - 0.25)
    renderer.setPixelRatio(dpr)
  }
}

let last = performance.now()
function frame(now) {
  requestAnimationFrame(frame)
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  controls.update(dt)

  const st = game.state
  const simulate = st === 'playing' || st === 'countdown' || st === 'finished'
  let alpha = 1
  if (simulate) {
    game.acc += dt
    let steps = 0
    while (game.acc >= PHYS.STEP && steps < PHYS.MAX_SUBSTEPS) {
      fixedStep(PHYS.STEP)
      game.acc -= PHYS.STEP
      steps++
    }
    if (steps === PHYS.MAX_SUBSTEPS) game.acc = 0
    alpha = game.acc / PHYS.STEP
    course.sync()
  }

  if (st === 'countdown') {
    game.countdown -= dt
    const step = Math.ceil(game.countdown - 0.2)
    if (step !== game.countStep) {
      game.countStep = step
      if (step > 0) {
        hud.countdown(String(step))
        sound.beep(false)
      }
    }
    if (game.countdown <= 0.2) {
      game.state = 'playing'
      hud.countdown('GO!')
      sound.beep(true)
    }
  } else if (st === 'playing') {
    game.time += dt
    checkCheckpoints()
    if (bike.pos.y < course.minY - 22) triggerRespawn()
    if (game.respawnTimer > 0) {
      game.respawnTimer -= dt
      if (!game.respawned && game.respawnTimer < 0.4) doRespawn()
      if (game.respawnTimer <= 0) game.respawnTimer = 0
    }
  } else if (st === 'finished') {
    if (game.finishTimer > 0) {
      game.finishTimer -= dt
      if (game.finishTimer <= 0) {
        updateBestLabel()
        showScreen(ui.finish)
        ui.touch.hidden = true
        hud.show(false)
      }
    }
  }

  const rs = renderState(alpha)
  if (st === 'menu') {
    rs.grounded = vehicleId !== 'car'
    rs.normal = new THREE.Vector3(0, 1, 0)
    rs.vy = 0
    rs.hSpeed = 0
    rs.lift = vehicleId === 'car'
    rs.active = true
  }
  if (st !== 'paused') {
    const ticks = model.update(dt, rs)
    if (ticks > 0) sound.pedalTick()
  }

  const falling = !bike.grounded && bike.pos.y < bike.lastGroundY - 6
  if (st === 'menu') {
    const kind = getVehicle(vehicleId).kind
    const dist = kind === 'heli' ? 12.5 : kind === 'car' ? 10.5 : 8.5
    const height = kind === 'heli' ? 4.1 : kind === 'car' ? 3.6 : 3.2
    rig.orbit(dt, course.startSpawn, dist, height, 0.18, kind === 'heli' ? 1.15 : 0.9)
  } else if (st !== 'paused') rig.update(dt, rs.pos, rs.yaw, bike.speed, falling)

  // Blob shadow
  rayFrom.set(rs.pos.x, rs.pos.y, rs.pos.z)
  rayTo.set(rs.pos.x, rs.pos.y - 40, rs.pos.z)
  shadowRay.reset()
  world.raycastClosest(rayFrom, rayTo, { collisionFilterMask: 1 | 4, skipBackfaces: true }, shadowRay)
  if (shadowRay.hasHit) {
    const h = shadowRay.distance
    const n = shadowRay.hitNormalWorld
    shadowNormal.set(n.x, n.y, n.z)
    shadow.visible = true
    shadow.position.set(shadowRay.hitPointWorld.x, shadowRay.hitPointWorld.y + 0.03, shadowRay.hitPointWorld.z)
    shadow.quaternion.setFromUnitVectors(ZUP, shadowNormal)
    const s = 1.6 + h * 0.08
    shadow.scale.set(s, s * 1.2, 1)
    shadow.material.opacity = Math.max(0.15, 1 - h / 25)
  } else {
    shadow.visible = false
  }

  if (st === 'playing' || st === 'countdown' || st === 'finished') {
    game.progressIdx = course.progress(bike.pos, game.progressIdx)
    const dist = course.path[game.progressIdx].s
    hud.update(Math.abs(bike.speed) * 3.6, game.time, dist, `${Math.min(game.cpIndex, checkpointCount)}/${checkpointCount}`)
    if (getVehicle(vehicleId).kind !== 'bike') ui.alt.querySelector('.val').textContent = String(Math.round(bike.pos.y - course.startSpawn.y))
    if (vehicleId === 'car') ui.energyFill.style.transform = `scaleX(${Math.max(0, Math.min(1, bike.energy))})`
    sound.update(bike.speed, bike.grounded && !bike.crashed, falling, bike.lifting, st === 'playing' || st === 'countdown')
    if (game.mode === 'multi') {
      mp.sendState(dt, localRiderState)
      const [rk, total] = mp.rank(dist, st === 'finished')
      const label = `${rk}/${total}`
      if (label !== game.lastRank) {
        game.lastRank = label
        ui.rankVal.textContent = label
      }
    }
  } else if (st === 'menu') {
    sound.silenceLoops()
  }

  if (mp.active) mp.update(dt, camera)
  env.update(dt, camera)
  renderer.render(scene, camera)
  if (simulate) adaptQuality(dt)
}

bike.reset(course.startSpawn, course.startYaw)
model.update(1 / 60, renderState(1))
showScreen(ui.menu)
syncRideLabel()
syncTouchLabels()
updateBestLabel()
requestAnimationFrame(frame)
