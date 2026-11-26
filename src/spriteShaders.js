/**
 * 2.5D shading for the flat sprite trees and clouds.
 *
 * Nothing here changes the sprite images. Each image gets a small companion "volume map"
 * (red/green = surface normal, blue = ambient occlusion) that is baked from the image's own
 * silhouette and brightness. The shader then lights the flat image as if it had volume:
 *
 *   - soft wrapped sun light and sky/ground ambient light, using the scene's real sun direction
 *   - ambient occlusion (deep canopy, lower leaves, trunk base are darker)
 *   - back light glow (leaves and clouds light up when the sun is behind them) and a soft sky rim
 *   - billboards lean back with the camera pitch so they do not look like standing cards
 *
 * Plain GLSL text only, so the exact same code can be compiled outside three.js for testing.
 */

// ---------------------------------------------------------------- billboard: vertex

export const VERT_DECL = /* glsl */ `
varying float vCamDist;
varying vec3 vSunT;
varying vec3 vUpT;
varying vec3 vViewT;
uniform vec3 sunDirW;

// Camera facing frame (world space). SPRITE_SPHERICAL: 1.0 = faces the camera fully (clouds),
// 0.0 = stays upright and turns around Y only (trees), leaning back by SPRITE_TILT of the camera pitch.
void spriteFrame(vec3 wc, out vec3 R, out vec3 U, out vec3 F) {
  if (SPRITE_SPHERICAL > 0.5) {
    R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  } else {
    vec3 toCam = cameraPosition - wc;
    vec3 hz = vec3(toCam.x, 0.0, toCam.z);
    float hl = length(hz);
    hz = hl > 0.0001 ? hz / hl : vec3(0.0, 0.0, 1.0);
    R = vec3(hz.z, 0.0, -hz.x);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    U = mix(vec3(0.0, 1.0, 0.0), camUp, SPRITE_TILT);
    U = normalize(U - R * dot(U, R));
    F = cross(R, U);
  }
}
`

export const VERT_BODY = /* glsl */ `
vec4 mvPosition;
{
  vec3 ctr = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
  vec3 wc = (modelMatrix * vec4(ctr, 1.0)).xyz;
  vec3 R; vec3 U; vec3 F;
  spriteFrame(wc, R, U, F);
  vec3 wp = wc + R * (position.x * sx) + U * (position.y * sy);
  mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vec3 toCam = cameraPosition - wc;
  vCamDist = length(toCam);
  toCam /= max(vCamDist, 0.001);
  // sun, world up and view direction expressed in the sprite's own frame (right, up, facing)
  vSunT = vec3(dot(sunDirW, R), dot(sunDirW, U), dot(sunDirW, F));
  vUpT = vec3(R.y, U.y, F.y);
  vViewT = vec3(dot(toCam, R), dot(toCam, U), dot(toCam, F));
}
`

// ---------------------------------------------------------------- billboard: fragment

export const FRAG_DECL = /* glsl */ `
varying float vCamDist;
varying vec3 vSunT;
varying vec3 vUpT;
varying vec3 vViewT;
uniform sampler2D dataMap;
uniform vec3 sunColor;
uniform vec3 skyColor;
uniform vec3 groundColor;
uniform vec4 litParams;   // x strength, y wrap, z translucency, w rim
uniform vec2 nearFade;    // camera distance where the sprite starts to fade out / is fully visible

vec3 spriteLight(vec3 albedo, vec3 dat) {
  vec2 nxy = dat.rg * 2.0 - 1.0;
  float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
  vec3 N = vec3(nxy, nz);
  float ao = dat.b;

  vec3 L = normalize(vSunT);
  vec3 V = normalize(vViewT);

  // soft wrapped diffuse: light bleeds around the form like it does through leaves and vapour
  float wrap = litParams.y;
  float diff = clamp((dot(N, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float hemi = clamp(dot(N, normalize(vUpT)) * 0.5 + 0.5, 0.0, 1.0);
  // sky light from above, warm green-grey bounce light from below (less blue than the scene's cold ground colour)
  vec3 gnd = mix(groundColor, vec3(0.58, 0.62, 0.50), 0.55);
  vec3 amb = mix(gnd, skyColor, hemi);

#ifdef SPRITE_CLOUD
  // vapour scatters the sun to near white, stays neutral, and its glow is white rather than the cloud's own blue
  vec3 sunL = mix(sunColor, vec3(dot(sunColor, vec3(0.3333))), 0.75);
  float expo = 2.0;
  float satBoost = 0.0;
  vec3 transCol = mix(albedo, vec3(1.0), 0.7);
#else
  vec3 sunL = sunColor;
  float expo = 1.8;
  float satBoost = 0.18;
  vec3 transCol = albedo;
#endif

  vec3 lit = amb * (0.46 * mix(1.0, ao, 0.75)) + sunL * (0.62 * diff * mix(1.0, ao, 0.45));
#ifdef SPRITE_CLOUD
  lit = mix(lit, vec3(0.62), 0.38);   // light keeps scattering inside vapour, so even the shaded side stays bright
#endif
  vec3 shaded = albedo * mix(vec3(1.0), lit * expo, litParams.x);

  // shade gets deeper and richer, not greyer
  float lum = dot(shaded, vec3(0.299, 0.587, 0.114));
  shaded = mix(vec3(lum), shaded, 1.0 + satBoost * litParams.x);

  // sun behind the object (seen from the camera): thin parts glow, thick parts stay darker
  float back = pow(clamp(-dot(L, V), 0.0, 1.0), 1.5);
  float thin = 0.35 + (1.0 - ao) * 0.8;
  float glow = back * litParams.z * thin * 1.5;
  glow *= mix(1.0, 1.0 - clamp(lum, 0.0, 1.0), 0.7);   // never blow out parts that are already bright
  shaded += transCol * sunL * glow;

  // soft sky coloured rim, silver when back lit: blends the silhouette into the air
  float rim = pow(1.0 - nz, 2.0);
  shaded += mix(skyColor, sunL, back) * (rim * litParams.w * (0.22 + 0.30 * back));

  return max(shaded, vec3(0.0));
}
`

/** Goes where three.js samples the main texture: reads the volume map and lights the colour. */
export const FRAG_LIGHT = /* glsl */ `
{
  vec4 dat = texture2D(dataMap, vMapUv);
  diffuseColor.rgb = spriteLight(diffuseColor.rgb, dat.rgb);
}
`

// ---------------------------------------------------------------- ground shadow

/**
 * Soft shadow of the real sprite silhouette, laid on the ground along the sun direction, plus a faint
 * contact shadow under the canopy. Clipped to the island disc so it never hangs in the air.
 * Instance attribute aClip = (island centre x, island centre z, island radius).
 */
export const SHADOW_VERT = /* glsl */ `
attribute vec3 aClip;
uniform vec3 sunDirW;
uniform vec2 shadowParams;   // x: shadow length as a fraction of the sprite height
varying float vU;
varying float vAlong;
varying vec2 vRel;
varying vec3 vWorld;
varying vec3 vClip;
varying float vBlobR;

void main() {
  vec3 ctr = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
  vec3 wc = (modelMatrix * vec4(ctr, 1.0)).xyz;

  vec2 dirXZ = -sunDirW.xz;
  float dl = length(dirXZ);
  dirXZ = dl > 0.0001 ? dirXZ / dl : vec2(0.0, 1.0);
  vec2 perp = vec2(-dirXZ.y, dirXZ.x);

  float B = sx * 0.5;                                  // room behind the trunk for the contact shadow
  float L = sy * shadowParams.x;                       // shadow length on the ground
  float across = max(sx * 0.56, B + 0.2);
  float dist = mix(-B, L, position.y + 0.5);           // distance along the shadow, negative = behind the trunk
  vec2 off = perp * (position.x * 2.0 * across) + dirXZ * dist;
  vec3 wp = wc + vec3(off.x, 0.0, off.y);

  vU = 0.5 + position.x * 2.0 * across / sx;
  vAlong = dist / L;
  vRel = off;
  vWorld = wp;
  vClip = aClip;
  vBlobR = sx * 0.42;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

export const SHADOW_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 shadowColor;
uniform float shadowOpacity;
varying float vU;
varying float vAlong;
varying vec2 vRel;
varying vec3 vWorld;
varying vec3 vClip;
varying float vBlobR;

void main() {
  float sil = 0.0;
  if (vAlong >= 0.0) {
    // the real sprite silhouette, sampled blurry (mip bias) so the edge is soft
    sil = texture2D(map, vec2(clamp(vU, 0.0, 1.0), clamp(vAlong, 0.0, 1.0)), 2.2).a;
    sil *= 1.0 - 0.55 * clamp(vAlong, 0.0, 1.0);                 // lighter and fuzzier far from the trunk
    sil *= smoothstep(0.0, 0.05, vU) * smoothstep(1.0, 0.95, vU) * smoothstep(1.0, 0.9, vAlong);
  }
  float blob = 1.0 - smoothstep(0.12 * vBlobR, vBlobR, length(vRel));
  float a = clamp(sil * 0.9 + blob * 0.45, 0.0, 1.0) * shadowOpacity;

  float d = distance(vWorld.xz, vClip.xy);
  a *= 1.0 - smoothstep(vClip.z - 0.9, vClip.z - 0.05, d);       // stay on the island
  a *= 1.0 - smoothstep(140.0, 300.0, length(cameraPosition - vWorld));
  gl_FragColor = vec4(shadowColor, a);
}
`
