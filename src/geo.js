import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _col = new THREE.Color()
const colorCache = new Map()

function toColor(value) {
  if (value === undefined) return undefined
  let c = colorCache.get(value)
  if (!c) {
    c = new THREE.Color(value)
    colorCache.set(value, c)
  }
  return c
}

/**
 * Bakes a geometry into world space with per-face vertex colors chosen by face orientation.
 * Top faces get no brightness jitter so coplanar overlapping pieces never flicker.
 */
export function bakeGeometry(source, matrix, colors, jitter = 0.06) {
  const g = source.index ? source.toNonIndexed() : source.clone()
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
  }
  if (matrix) g.applyMatrix4(matrix)

  const top = toColor(colors.top ?? colors.all ?? colors.side)
  const side = toColor(colors.side ?? colors.all ?? colors.top)
  const bottom = toColor(colors.bottom ?? colors.side ?? colors.all)
  const uniform = colors.all !== undefined

  const pos = g.attributes.position
  const arr = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i)
    _b.fromBufferAttribute(pos, i + 1).sub(_a)
    _c.fromBufferAttribute(pos, i + 2).sub(_a)
    _b.cross(_c).normalize()
    const ny = _b.y
    const base = uniform ? top : ny > 0.6 ? top : ny < -0.6 ? bottom : side
    const isTop = ny > 0.6
    const k = isTop && !uniform ? 1 : 1 + (Math.random() * 2 - 1) * jitter
    _col.copy(base).multiplyScalar(k)
    for (let j = 0; j < 3; j++) {
      const o = (i + j) * 3
      arr[o] = _col.r
      arr[o + 1] = _col.g
      arr[o + 2] = _col.b
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Collects baked geometries into buckets so the static world renders in a handful of draw calls. */
export class StaticBatcher {
  constructor() {
    this.buckets = new Map()
  }

  add(geo, matrix, colors, key = 0, jitter) {
    let list = this.buckets.get(key)
    if (!list) {
      list = []
      this.buckets.set(key, list)
    }
    list.push(bakeGeometry(geo, matrix, colors, jitter))
  }

  build(material, parent) {
    const meshes = []
    for (const list of this.buckets.values()) {
      if (!list.length) continue
      const merged = mergeGeometries(list, false)
      for (const g of list) g.dispose()
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, material)
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      parent.add(mesh)
      meshes.push(mesh)
    }
    this.buckets.clear()
    return meshes
  }
}

export function mergeBaked(list) {
  const merged = mergeGeometries(list, false)
  for (const g of list) g.dispose()
  merged.computeBoundingSphere()
  return merged
}
