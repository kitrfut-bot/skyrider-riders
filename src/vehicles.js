import { BIKE } from './constants.js'

/**
 * Every ride in the garage. `kind` picks the physics mode and the 3D model:
 *   bike - pedal, lean and jump (the original Sky Rider handling)
 *   car  - drives on wheels, hold Lift to fire the thrusters, glides with its wings
 *   heli - free flight: climb, descend and hover anywhere
 * Stats are 1-5 bars for the garage screen only.
 */
export const VEHICLES = [
  {
    id: 'road',
    kind: 'bike',
    name: 'Sky Racer',
    type: 'Road bike',
    desc: 'The classic. Balanced speed and handling for every part of the course.',
    hint: 'Pedal, brake and jump. Lean through the corners.',
    stats: { speed: 3, accel: 3, handling: 3, air: 2 },
    phys: { ...BIKE },
  },
  {
    id: 'bmx',
    kind: 'bike',
    name: 'Hopper BMX',
    type: 'BMX',
    desc: 'Small wheels, big air. Turns on a coin and survives rough landings.',
    hint: 'Jumps much higher than the other bikes. Lower top speed.',
    stats: { speed: 2, accel: 4, handling: 5, air: 4 },
    phys: { ...BIKE, MAX_SPEED: 14.5, ACCEL: 8.6, JUMP: 8.7, TURN: 2.95, GRIP: 11, CRASH_LAND: 28 },
  },
  {
    id: 'mtb',
    kind: 'bike',
    name: 'Trail Beast',
    type: 'Mountain bike',
    desc: 'Fat knobby tyres and full suspension. Hard to knock over.',
    hint: 'Grips like glue and shrugs off bumps, walls and big drops.',
    stats: { speed: 3, accel: 3, handling: 4, air: 3 },
    phys: { ...BIKE, MAX_SPEED: 16, ACCEL: 7.4, JUMP: 7.3, TURN: 2.4, GRIP: 14, CRASH_WALL: 13, CRASH_LAND: 34 },
  },
  {
    id: 'car',
    kind: 'car',
    name: 'Aero Coupe',
    type: 'Flying car',
    desc: 'The fastest thing on wheels. Fire the thrusters to hop gaps, then glide on fold-out wings.',
    hint: 'Hold Lift to fly. Thrust runs out in the air and refills on the ground.',
    stats: { speed: 5, accel: 4, handling: 2, air: 4 },
    phys: {
      ...BIKE,
      MAX_SPEED: 22,
      ACCEL: 9,
      BRAKE: 20,
      REVERSE: 5,
      GRIP: 12,
      TURN: 2.05,
      ROLL_DRAG: 0.08,
      CRASH_WALL: 13,
      CRASH_LAND: 30,
      THRUST: 29, // upward acceleration while Lift is held (gravity is 18)
      MAX_RISE: 7.5,
      MAX_SINK: 6.5, // wings: fastest fall speed while gliding
      GLIDE: 0.55, // share of gravity the wings cancel
      AIR_MAX: 21,
      ENERGY: 3.2, // seconds of thrust when full
      RECHARGE: 0.45, // share of a full tank refilled per second on the ground
    },
  },
  {
    id: 'heli',
    kind: 'heli',
    name: 'Whirlybird',
    type: 'Helicopter',
    desc: 'Fly anywhere and hover in place. Slower than the others, but nothing can stop it.',
    hint: 'Hold Up to climb, Down to descend. Fly low through every checkpoint.',
    stats: { speed: 2, accel: 2, handling: 4, air: 5 },
    phys: {
      ...BIKE,
      MAX_SPEED: 15,
      ACCEL: 6,
      BRAKE: 10,
      REVERSE: 4,
      TURN: 1.9,
      CLIMB: 6.5,
      DESCEND: 7,
      CRASH_WALL: 11,
      CRASH_LAND: 18,
    },
  },
]

export const VEHICLE_IDS = VEHICLES.map((v) => v.id)
export const DEFAULT_VEHICLE = 'road'

export function getVehicle(id) {
  return VEHICLES.find((v) => v.id === id) || VEHICLES[0]
}

export function cleanVehicle(id) {
  return VEHICLE_IDS.includes(id) ? id : DEFAULT_VEHICLE
}

/** Paint colours offered in the garage (solo rides). Online rooms use the colour of your room slot. */
export const PAINTS = ['#ff3d57', '#2d8cff', '#27c46b', '#ff8a1f', '#ff5fa2', '#12c2c2', '#ffd23f', '#2a2d34', '#f4f4f4', '#8e5cff']

/** Touch button labels per kind. */
export const BUTTON_LABELS = {
  bike: { jump: 'Jump', accel: 'Pedal' },
  car: { jump: 'Lift', accel: 'Drive' },
  heli: { jump: 'Up', accel: 'Fly' },
}

/** Small line icons (24x24) used in the garage, the menu and the online roster. */
const ICON_PATHS = {
  road: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16l4-7h6l3 7M9.5 9l3 7 3-7M14 6h3"/>',
  bmx: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l5-5h4l3 5M11 12l2 5M15 12l1-5h3M9 10h3"/>',
  mtb: '<circle cx="5.5" cy="16" r="4"/><circle cx="18.5" cy="16" r="4"/><path d="M5.5 16l4.5-7h5l3.5 7M10 9l2.5 7L15 9M15 9l1.5-3h2.5"/>',
  car: '<path d="M3 15l2-5h9l4 3h3v3H3z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M6 10l1-3h5l2 3M1 12h2M21 12l2-2"/>',
  heli: '<path d="M3 5h18M12 5v3"/><path d="M5 12c0-2 2-4 5-4h3c3 0 5 2 5 4v1c0 1-1 2-2 2H7c-1 0-2-1-2-2z"/><path d="M18 11h4l1-2M8 15l-1 3M15 15l1 3M5 18h14"/>',
}

export function vehicleIcon(id, size = 22) {
  const p = ICON_PATHS[id] || ICON_PATHS.road
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
}
