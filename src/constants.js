export const GROUP = { STATIC: 1, BIKE: 2, CRATE: 4 }

export const PHYS = {
  GRAVITY: -18,
  STEP: 1 / 60,
  MAX_SUBSTEPS: 4,
}

export const BIKE = {
  RADIUS: 0.5,
  MAX_SPEED: 17,
  ACCEL: 7,
  BRAKE: 16,
  REVERSE: 3,
  GRIP: 9,
  JUMP: 6.8,
  ROLL_DRAG: 0.1,
  COAST_DRAG: 0.08,
  TURN: 2.3,
  CRASH_WALL: 10,
  CRASH_LAND: 23,
}

export const STORAGE = {
  BEST: 'skyrider-best-time',
  MUTED: 'skyrider-muted',
  NAME: 'skyrider-player-name',
  VEHICLE: 'skyrider-vehicle',
  PAINT: 'skyrider-paint',
  RIDER: 'skyrider-rider',
}
