import * as THREE from 'three'

const CAP = new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56)
const BALL = new THREE.SphereGeometry(1, 8, 6)
const BOX = new THREE.BoxGeometry(1, 1, 1)

/**
 * Hair and eyes for a character, built around a head of radius ~0.115 whose centre sits at
 * (0, -0.025, 0.01) in the group's own space (the same anchor the helmet uses). Scale the group
 * for bigger heads. Everything is a plain mesh with shared geometry; `disposeObject` handles cleanup.
 */
export function makeHair(look) {
  const g = new THREE.Group()
  const hairMat = new THREE.MeshLambertMaterial({ color: look.hair })
  const dark = new THREE.MeshBasicMaterial({ color: '#1a1210' })

  const cap = new THREE.Mesh(CAP, hairMat)
  cap.scale.set(1.02, 0.95, 1.1)
  g.add(cap)

  const add = (geo, pos, scale, rot) => {
    const m = new THREE.Mesh(geo, hairMat)
    m.position.set(...pos)
    m.scale.set(...scale)
    if (rot) m.rotation.set(...rot)
    g.add(m)
    return m
  }

  if (look.hairStyle === 'quiff') {
    // swept-up front
    add(BALL, [0, 0.085, 0.07], [0.105, 0.06, 0.1], [-0.35, 0, 0])
    add(BALL, [0.03, 0.09, 0.03], [0.07, 0.05, 0.09], [-0.2, 0, 0.3])
  } else if (look.hairStyle === 'curly') {
    // a crown of curls
    const curls = [
      [0, 0.1, 0.0, 0.058],
      [0.07, 0.085, 0.04, 0.05],
      [-0.07, 0.085, 0.04, 0.05],
      [0.085, 0.06, -0.03, 0.05],
      [-0.085, 0.06, -0.03, 0.05],
      [0.04, 0.095, -0.07, 0.05],
      [-0.04, 0.095, -0.07, 0.05],
      [0, 0.07, 0.09, 0.045],
      [0, 0.04, -0.105, 0.055],
    ]
    for (const [x, y, z, r] of curls) add(BALL, [x, y, z], [r, r, r])
  } else {
    // side-swept fringe over the forehead
    add(BOX, [0.015, 0.025, 0.105], [0.19, 0.045, 0.05], [0.15, 0, -0.12])
    add(BALL, [-0.07, 0.04, 0.085], [0.06, 0.045, 0.05], [0, 0, 0.4])
    add(BALL, [0, 0.085, 0.02], [0.1, 0.045, 0.11])
  }

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(BALL, dark)
    eye.position.set(s * 0.042, -0.013, 0.113)
    eye.scale.setScalar(0.014)
    g.add(eye)
  }
  return g
}

/** Material for a rider part: lit normally, or a bright unlit glow for neon trim. */
export function accentMaterial(look) {
  return look.glow
    ? new THREE.MeshBasicMaterial({ color: look.accent, fog: false })
    : new THREE.MeshLambertMaterial({ color: look.accent })
}
