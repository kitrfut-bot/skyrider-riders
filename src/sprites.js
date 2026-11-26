import * as THREE from 'three'
import SPRITE_INFO from './assets/sprites.json'
import cloud1 from './assets/cloud1.webp'
import cloud2 from './assets/cloud2.webp'
import cloud3 from './assets/cloud3.webp'
import tree1 from './assets/tree1.webp'
import tree2 from './assets/tree2.webp'
import bush1 from './assets/bush1.webp'
import blossom from './assets/blossom.webp'
import cloud1d from './assets/cloud1_d.webp'
import cloud2d from './assets/cloud2_d.webp'
import cloud3d from './assets/cloud3_d.webp'
import tree1d from './assets/tree1_d.webp'
import tree2d from './assets/tree2_d.webp'
import bush1d from './assets/bush1_d.webp'
import blossomd from './assets/blossom_d.webp'
import { VERT_DECL, VERT_BODY, FRAG_DECL, FRAG_LIGHT, SHADOW_VERT, SHADOW_FRAG } from './spriteShaders.js'

/**
 * Sprite images. To swap one, replace the file in src/assets and update the aspect ratio
 * (width / height) in src/assets/sprites.json. The matching "_d" file is its volume map
 * (normal + ambient occlusion), baked from the image itself; re-bake it when the image changes.
 */
export const SPRITES = {
  cloud1: { url: cloud1, data: cloud1d, aspect: SPRITE_INFO.cloud1.aspect },
  cloud2: { url: cloud2, data: cloud2d, aspect: SPRITE_INFO.cloud2.aspect },
  cloud3: { url: cloud3, data: cloud3d, aspect: SPRITE_INFO.cloud3.aspect },
  tree1: { url: tree1, data: tree1d, aspect: SPRITE_INFO.tree1.aspect },
  tree2: { url: tree2, data: tree2d, aspect: SPRITE_INFO.tree2.aspect },
  bush1: { url: bush1, data: bush1d, aspect: SPRITE_INFO.bush1.aspect },
  blossom: { url: blossom, data: blossomd, aspect: SPRITE_INFO.blossom.aspect },
}

/**
 * How each sprite is lit.
 *  lit    = [strength, wrap, translucency, rim]   strength 0 = original flat image, 1 = fully lit
 *  tilt   = how much an upright sprite leans back with the camera pitch (0 = never, 1 = like the camera)
 *  shadow = casts a soft ground shadow (needs island clip data on the items)
 */
const LOOK = {
  tree1: { lit: [0.9, 0.45, 0.45, 0.55], tilt: 0.45, shadow: true },
  tree2: { lit: [0.9, 0.4, 0.4, 0.5], tilt: 0.45, shadow: true },
  bush1: { lit: [0.85, 0.5, 0.35, 0.45], tilt: 0.3, shadow: true },
  blossom: { lit: [0.8, 0.5, 0.5, 0.5], tilt: 0.25, shadow: false },
  cloud1: { lit: [0.75, 0.9, 0.65, 0.6], tilt: 0, shadow: false },
  cloud2: { lit: [0.75, 0.9, 0.65, 0.6], tilt: 0, shadow: false },
  cloud3: { lit: [0.75, 0.9, 0.65, 0.6], tilt: 0, shadow: false },
}

/** Light shared by every sprite. Filled from the real scene lights by syncSpriteLighting(). */
const LIGHT = {
  sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() },
  sunColor: { value: new THREE.Color('#fff1d6') },
  skyColor: { value: new THREE.Color('#dff1ff') },
  groundColor: { value: new THREE.Color('#7c8aa3') },
}

/** Read the sun and sky colours from the scene so sprite shading always matches the world lighting. */
export function syncSpriteLighting(scene) {
  scene.traverse((o) => {
    if (o.isDirectionalLight) {
      LIGHT.sunDir.value.copy(o.position).sub(o.target.position).normalize()
      LIGHT.sunColor.value.copy(o.color)
    } else if (o.isHemisphereLight) {
      LIGHT.skyColor.value.copy(o.color)
      LIGHT.groundColor.value.copy(o.groundColor)
    }
  })
}

const loader = new THREE.TextureLoader()
const textureCache = new Map()
const dataCache = new Map()

export function spriteTexture(name, maxAniso = 4) {
  let tex = textureCache.get(name)
  if (!tex) {
    tex = loader.load(SPRITES[name].url)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAniso
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    textureCache.set(name, tex)
  }
  return tex
}

/** Volume map: red/green = normal, blue = ambient occlusion. Linear data, never colour converted. */
export function spriteDataTexture(name) {
  let tex = dataCache.get(name)
  if (!tex) {
    tex = loader.load(SPRITES[name].data)
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    dataCache.set(name, tex)
  }
  return tex
}

/**
 * One draw call for many camera-facing quads, shaded to look volumetric.
 *  mode 'cyl'  stays upright and only turns around the Y axis (trees, bushes)
 *  mode 'sph'  always faces the camera fully (clouds)
 * Trees use alpha-test with a dithered fade when the camera gets close so they never block the view of
 * the bike. Clouds use soft alpha blending and fade out when the camera is inside them.
 *
 * items: { x, y, z, h } plus optional { gy, cx, cz, cr } = ground height and island disc for the ground shadow.
 * `mesh` is a group holding the shadow mesh (if any) and the billboard mesh, so callers just add `mesh`.
 */
export class BillboardSet {
  constructor(name, items, { mode = 'cyl', anchor = 'bottom', fade = false, soft = false, opacity = 1 } = {}) {
    const info = SPRITES[name]
    const look = LOOK[name] || LOOK.tree1
    this.name = name
    this.mesh = new THREE.Group()

    // ---- the sprite itself
    const geo = new THREE.PlaneGeometry(1, 1)
    if (anchor === 'bottom') geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshBasicMaterial({
      map: spriteTexture(name),
      transparent: soft,
      alphaTest: soft ? 0.01 : 0.45,
      depthWrite: !soft,
      opacity,
      side: THREE.DoubleSide,
      fog: true,
    })
    const sph = mode === 'sph'
    const tilt = sph ? 0 : look.tilt
    mat.defines = {
      SPRITE_SPHERICAL: sph ? '1.0' : '0.0',
      SPRITE_TILT: tilt.toFixed(3),
    }
    const isCloud = name.startsWith('cloud')
    if (isCloud) mat.defines.SPRITE_CLOUD = ''
    if (fade) mat.defines.SPRITE_DITHER = ''
    else if (soft) mat.defines.SPRITE_ALPHA_FADE = ''
    const dataTex = spriteDataTexture(name)
    const litParams = new THREE.Vector4(...look.lit)
    const nearFade = new THREE.Vector2(...(fade ? [2.5, 9] : soft ? [8, 26] : [0, 0]))
    // the shader text depends on these switches, so each variant needs its own program cache key
    mat.customProgramCacheKey = () => `billboard-${sph ? 'sph' : 'cyl'}-${fade ? 'dither' : soft ? 'alpha' : 'solid'}-${isCloud ? 'cloud' : 'plant'}`
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.dataMap = { value: dataTex }
      shader.uniforms.sunDirW = LIGHT.sunDir
      shader.uniforms.sunColor = LIGHT.sunColor
      shader.uniforms.skyColor = LIGHT.skyColor
      shader.uniforms.groundColor = LIGHT.groundColor
      shader.uniforms.litParams = { value: litParams }
      shader.uniforms.nearFade = { value: nearFade }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
        .replace('#include <project_vertex>', VERT_BODY)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
        .replace(
          '#include <alphatest_fragment>',
          /* glsl */ `
          #ifdef SPRITE_ALPHA_FADE
            diffuseColor.a *= smoothstep(nearFade.x, nearFade.y, vCamDist);
          #endif
          #ifdef SPRITE_DITHER
            {
              float fk = smoothstep(nearFade.x, nearFade.y, vCamDist);
              float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              if (fk < dither) discard;
            }
          #endif
          #include <alphatest_fragment>
          ${FRAG_LIGHT}`,
        )
    }

    const board = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length))
    board.count = items.length
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    items.forEach((it, i) => {
      // it.h is the sprite height in world units, width follows the image aspect
      s.set(it.h * info.aspect, it.h, 1)
      m.compose(p.set(it.x, it.y, it.z), q, s)
      board.setMatrixAt(i, m)
    })
    board.instanceMatrix.needsUpdate = true
    board.frustumCulled = false
    if (soft) board.renderOrder = 2
    this.board = board

    // ---- soft ground shadow, only for sprites that stand on an island
    const shadowItems = look.shadow ? items.filter((it) => it.cr != null) : []
    if (shadowItems.length) {
      const sgeo = new THREE.PlaneGeometry(1, 1)
      const clip = new Float32Array(shadowItems.length * 3)
      const smat = new THREE.ShaderMaterial({
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        uniforms: {
          map: { value: spriteTexture(name) },
          sunDirW: LIGHT.sunDir,
          shadowParams: { value: new THREE.Vector2(0.7, 0) },
          shadowColor: { value: new THREE.Color('#0a1a33') },
          shadowOpacity: { value: 0.4 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const shadow = new THREE.InstancedMesh(sgeo, smat, shadowItems.length)
      shadowItems.forEach((it, i) => {
        s.set(it.h * info.aspect, it.h, 1)
        const gy = (it.gy != null ? it.gy : it.y) + 0.04
        m.compose(p.set(it.x, gy, it.z), q, s)
        shadow.setMatrixAt(i, m)
        clip[i * 3] = it.cx
        clip[i * 3 + 1] = it.cz
        clip[i * 3 + 2] = it.cr
      })
      sgeo.setAttribute('aClip', new THREE.InstancedBufferAttribute(clip, 3))
      shadow.instanceMatrix.needsUpdate = true
      shadow.frustumCulled = false
      shadow.renderOrder = 1
      this.shadow = shadow
      this.mesh.add(shadow)
    }
    this.mesh.add(board)
  }
}
