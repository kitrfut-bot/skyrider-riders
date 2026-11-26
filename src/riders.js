/**
 * Riders you can put on the bikes (and in the car / helicopter seat).
 * `classic` is the original rider: it wears the paint colour you pick in the garage.
 * The others are fixed characters with their own hair, outfit and shoes.
 *
 * To rename a rider or tweak a colour, edit it here - nothing else needs to change.
 *   hair: 'quiff' | 'curly' | 'fringe'      sleeves: 'long' | 'short'      boot: taller ankle on the shoes
 *   glow: true draws the accent colour as a bright, unlit glow (the neon trim)
 */
export const RIDERS = [
  {
    id: 'classic',
    name: 'Classic',
    desc: 'The original rider. Wears your paint colour.',
    chip: ['#ffb000', '#23252e'],
    look: null,
  },
  {
    id: 'ember',
    name: 'Ember',
    desc: 'Black racing jacket with orange panels, cargo pants and chunky orange sneakers.',
    chip: ['#17181d', '#ff7a12'],
    look: {
      skin: '#c98b66',
      hair: '#0e0e12',
      hairStyle: 'quiff',
      jacket: '#17181d',
      accent: '#ff7a12',
      sleeves: 'long',
      sleeve: '#17181d',
      under: '#17181d',
      pants: '#25252c',
      shoe: '#17181d',
      shoeAccent: '#ff7a12',
      sole: '#f2f2f2',
      collar: true,
      zip: true,
      glow: false,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    desc: 'Navy vest over a dark tee, slate shoulder panels, dark jeans and lace-up boots.',
    chip: ['#2f3d6b', '#5b7088'],
    look: {
      skin: '#b98260',
      hair: '#2a1b15',
      hairStyle: 'curly',
      jacket: '#2f3d6b',
      accent: '#5b7088',
      sleeves: 'short',
      sleeve: '#2f3d6b',
      under: '#1e2536',
      pants: '#1d2234',
      shoe: '#1d2234',
      shoeAccent: '#2b3350',
      sole: '#12151f',
      boot: true,
      collar: true,
      zip: false,
      glow: false,
    },
  },
  {
    id: 'volt',
    name: 'Volt',
    desc: 'Steel-grey tech jacket with glowing cyan trim, strapped pants and neon high-tops.',
    chip: ['#4a5d70', '#27e6ff'],
    look: {
      skin: '#c48b64',
      hair: '#0d0d12',
      hairStyle: 'fringe',
      jacket: '#4a5d70',
      accent: '#27e6ff',
      sleeves: 'long',
      sleeve: '#3f5164',
      under: '#1a1d24',
      pants: '#1c2129',
      shoe: '#323f4d',
      shoeAccent: '#27e6ff',
      sole: '#b7d3e2',
      boot: true,
      collar: true,
      zip: true,
      glow: true,
    },
  },
]

export const RIDER_IDS = RIDERS.map((r) => r.id)
export const DEFAULT_RIDER = 'classic'

export function getRider(id) {
  return RIDERS.find((r) => r.id === id) || RIDERS[0]
}

export function cleanRider(id) {
  return RIDER_IDS.includes(id) ? id : DEFAULT_RIDER
}

/** Look data for a rider id, or null for the classic rider. */
export function riderLook(id) {
  return getRider(id).look
}
