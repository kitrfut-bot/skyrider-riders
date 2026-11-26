import * as THREE from 'three'
import { StaticBatcher, bakeGeometry, mergeBaked } from './geo.js'
import { BillboardSet, SPRITES } from './sprites.js'

const V3 = THREE.Vector3
const SKY_TOP = new THREE.Color('#2f7fe0')
const SKY_HORIZON = new THREE.Color('#cfe8ff')
const SUN_DIR = new V3(0.45, 0.55, 0.7).normalize()

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Sky dome, lighting, instanced clouds and distant decorative islands. */
export class Environment {
  constructor(scene, course) {
    this.scene = scene
    const rand = rng(42)
    scene.background = SKY_HORIZON.clone()
    scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 90, 430)

    scene.add(new THREE.HemisphereLight('#dff1ff', '#7c8aa3', 1.9))
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4)
    sun.position.copy(SUN_DIR).multiplyScalar(100)
    scene.add(sun)

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: SKY_TOP },
          horizon: { value: SKY_HORIZON },
          sunDir: { value: SUN_DIR },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 col = mix(horizon, top, pow(h, 0.55));
            float s = max(dot(d, sunDir), 0.0);
            col += vec3(1.0, 0.92, 0.75) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    )
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    scene.add(this.sky)

    const path = course.path
    const nearPath = (x, z, minDist) => {
      for (let i = 0; i < path.length; i += 3) {
        const p = path[i]
        if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) return true
      }
      return false
    }

    // Cloud sea and puffs
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: '#f2f8ff' }),
    )
    sea.rotation.x = -Math.PI / 2
    sea.position.set(30, course.minY - 55, 280)
    scene.add(sea)

    // Sprite clouds (camera-facing cards, one draw call per cloud image)
    const cloudNames = ['cloud1', 'cloud2', 'cloud3']
    const cloudLists = { cloud1: [], cloud2: [], cloud3: [] }
    const addCloud = (x, y, z, width) => {
      const name = cloudNames[Math.floor(rand() * cloudNames.length)]
      cloudLists[name].push({ x, y, z, h: width / SPRITES[name].aspect })
    }
    // big sea of clouds below the course
    for (let i = 0; i < 55; i++) {
      const p = path[Math.floor(rand() * path.length)]
      const a = rand() * Math.PI * 2
      const r = 25 + rand() * 200
      addCloud(p.x + Math.sin(a) * r, course.minY - 16 - rand() * 30, p.z + Math.cos(a) * r, 34 + rand() * 50)
    }
    // clouds drifting around and above the course
    for (let i = 0; i < 32; i++) {
      const p = path[Math.floor(rand() * path.length)]
      const a = rand() * Math.PI * 2
      const r = 70 + rand() * 200
      const x = p.x + Math.sin(a) * r
      const z = p.z + Math.cos(a) * r
      if (nearPath(x, z, 60)) continue
      addCloud(x, p.y - 4 + rand() * 32, z, 26 + rand() * 34)
    }
    this.cloudGroup = new THREE.Group()
    for (const name of cloudNames) {
      if (!cloudLists[name].length) continue
      const set = new BillboardSet(name, cloudLists[name], { mode: 'sph', anchor: 'center', soft: true, opacity: 0.96 })
      this.cloudGroup.add(set.mesh)
    }
    scene.add(this.cloudGroup)

    // Distant decorative islands
    const batch = new StaticBatcher()
    const flip = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), Math.PI)
    const id = new THREE.Quaternion()
    const mtx = new THREE.Matrix4()
    let placed = 0
    const farTrees = { tree1: [], tree2: [] }
    for (let tries = 0; tries < 200 && placed < 34; tries++) {
      const p = path[Math.floor(rand() * path.length)]
      const a = rand() * Math.PI * 2
      const dist = 60 + rand() * 220
      const x = p.x + Math.sin(a) * dist
      const z = p.z + Math.cos(a) * dist
      if (nearPath(x, z, 42)) continue
      const y = p.y + (rand() - 0.5) * 40
      const r = 4 + rand() * 10
      const key = placed % 4
      mtx.compose(new V3(x, y - 0.6, z), id, new V3(r, 1.2, r))
      batch.add(new THREE.CylinderGeometry(1, 0.95, 1, 10), mtx, { top: '#8bd36a', side: '#a87447' }, key)
      mtx.compose(new V3(x, y - 1.2 - r * 0.7, z), flip, new V3(r * 0.92, r * 1.4, r * 0.92))
      batch.add(new THREE.ConeGeometry(1, 1, 8), mtx, { all: '#8a5c38' }, key, 0.12)
      const trees = Math.floor(rand() * 3)
      for (let t = 0; t < trees; t++) {
        const ta = rand() * Math.PI * 2
        const tr = rand() * r * 0.6
        const kind = rand() < 0.5 ? 'tree1' : 'tree2'
        const hh = (kind === 'tree1' ? 4.2 : 5.6) * (0.8 + rand() * 0.5)
        farTrees[kind].push({ x: x + Math.sin(ta) * tr, y, z: z + Math.cos(ta) * tr, h: hh })
      }
      if (rand() < 0.3) {
        mtx.compose(new V3(x, y + 5 + rand() * 4, z), id, new V3(0.6, 0.6, 0.6).multiplyScalar(r * 0.3))
        batch.add(new THREE.OctahedronGeometry(1, 0), mtx, { all: '#7ff0ff' }, key, 0.15)
      }
      placed++
    }
    batch.build(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), scene)
    for (const name of ['tree1', 'tree2']) {
      if (farTrees[name].length) scene.add(new BillboardSet(name, farTrees[name], { mode: 'cyl', anchor: 'bottom' }).mesh)
    }

    // Floating blossom-tree islands far from the course (the image already includes its island)
    const blossoms = []
    for (let tries = 0; tries < 120 && blossoms.length < 10; tries++) {
      const p = path[Math.floor(rand() * path.length)]
      const a = rand() * Math.PI * 2
      const dist = 95 + rand() * 190
      const x = p.x + Math.sin(a) * dist
      const z = p.z + Math.cos(a) * dist
      if (nearPath(x, z, 80)) continue
      blossoms.push({ x, y: p.y - 18 + rand() * 40, z, h: 20 + rand() * 16 })
    }
    if (blossoms.length) scene.add(new BillboardSet('blossom', blossoms, { mode: 'cyl', anchor: 'bottom' }).mesh)

    // Hot air balloons
    this.balloons = []
    const colors = ['#ff5a5f', '#ffb000', '#2fc3a0', '#8f6bff', '#ff8a1f']
    for (let i = 0; i < 5; i++) {
      const p = path[Math.floor((i + 0.5) / 5 * path.length)]
      const a = rand() * Math.PI * 2
      const dist = 70 + rand() * 60
      const parts = []
      const envelope = new THREE.SphereGeometry(4, 12, 10)
      envelope.scale(1, 1.2, 1)
      const nonIdx = envelope.toNonIndexed()
      const stripeA = bakeGeometry(nonIdx, null, { all: colors[i] }, 0.05)
      const pos = stripeA.attributes.position
      const col = stripeA.attributes.color
      for (let v = 0; v < pos.count; v += 3) {
        const ang = Math.atan2(pos.getX(v), pos.getZ(v))
        if (Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 12) % 2 === 0) {
          for (let j = 0; j < 3; j++) col.setXYZ(v + j, 0.95, 0.95, 0.92)
        }
      }
      parts.push(stripeA)
      mtx.compose(new V3(0, -6.2, 0), id, new V3(1.4, 1, 1.4))
      parts.push(bakeGeometry(new THREE.BoxGeometry(1, 1, 1), mtx, { all: '#8a5a33' }))
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const a1 = new V3(sx * 0.6, -5.7, sz * 0.6)
        const b1 = new V3(sx * 2.2, -3.6, sz * 2.2)
        const d = b1.clone().sub(a1)
        const len = d.length()
        mtx.compose(a1.clone().add(b1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()), new V3(0.04, len, 0.04))
        parts.push(bakeGeometry(new THREE.CylinderGeometry(1, 1, 1, 4), mtx, { all: '#5a3b22' }))
      }
      const mesh = new THREE.Mesh(mergeBaked(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))
      const base = new V3(p.x + Math.sin(a) * dist, p.y + 12 + rand() * 18, p.z + Math.cos(a) * dist)
      mesh.position.copy(base)
      scene.add(mesh)
      this.balloons.push({ mesh, base, phase: rand() * 6 })
    }

    this.time = 0
  }

  update(dt, camera) {
    this.time += dt
    this.sky.position.copy(camera.position)
    this.cloudGroup.position.x = Math.sin(this.time * 0.03) * 6
    for (const b of this.balloons) {
      b.mesh.position.y = b.base.y + Math.sin(this.time * 0.4 + b.phase) * 1.5
      b.mesh.rotation.y += dt * 0.05
    }
  }
}
