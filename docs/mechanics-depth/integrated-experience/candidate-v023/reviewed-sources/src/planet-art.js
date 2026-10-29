/** Deterministic, transparent planet portraits. No renderer or image assets required. */
const SIZE = 320;
const RADIUS = 139;
const MAX_IMAGES = 50;
const images = new Map();
const supported = new Set(['terran', 'ocean', 'arid', 'ice', 'volcanic', 'barren']);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((channel, index) => channel + (b[index] - channel) * clamp(t));

function hash(text) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function makeNoise(seed) {
  const next = random(seed);
  const permutation = Array.from({ length: 256 }, (_, index) => index);
  for (let index = 255; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [permutation[index], permutation[other]] = [permutation[other], permutation[index]];
  }
  const p = new Uint16Array(512);
  for (let index = 0; index < 512; index++) p[index] = permutation[index & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const gradient = (code, x, y, z) => {
    const h = code & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  function noise(x, y, z) {
    const floorX = Math.floor(x), floorY = Math.floor(y), floorZ = Math.floor(z);
    const X = floorX & 255, Y = floorY & 255, Z = floorZ & 255;
    x -= floorX; y -= floorY; z -= floorZ;
    const u = fade(x), v = fade(y), w = fade(z);
    const a = p[X] + Y, aa = p[a] + Z, ab = p[a + 1] + Z;
    const b = p[X + 1] + Y, ba = p[b] + Z, bb = p[b + 1] + Z;
    return lerp(
      lerp(lerp(gradient(p[aa], x, y, z), gradient(p[ba], x - 1, y, z), u),
        lerp(gradient(p[ab], x, y - 1, z), gradient(p[bb], x - 1, y - 1, z), u), v),
      lerp(lerp(gradient(p[aa + 1], x, y, z - 1), gradient(p[ba + 1], x - 1, y, z - 1), u),
        lerp(gradient(p[ab + 1], x, y - 1, z - 1), gradient(p[bb + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  return (x, y, z, octaves = 4) => {
    let value = 0, amplitude = .55;
    for (let octave = 0; octave < octaves; octave++) {
      value += noise(x, y, z) * amplitude;
      x = x * 2.03 + 13.7; y = y * 2.03 + 3.1; z = z * 2.03 + 8.3;
      amplitude *= .49;
    }
    return value;
  };
}

function craters(seed) {
  const next = random(seed ^ 0x914b83);
  return Array.from({ length: 42 }, (_, index) => {
    const angle = next() * Math.PI * 2, z = next() * 2 - 1;
    const radius = Math.sqrt(1 - z * z);
    return {
      x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z,
      radius: index < 7 ? .13 + next() * .16 : .025 + next() * .09,
    };
  });
}

function paint(type, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d');
  const frame = context.createImageData(SIZE, SIZE);
  const pixels = frame.data;
  const noise = makeNoise(seed);
  const next = random(seed);
  const offset = [next() * 25 + 5, next() * 25 + 5, next() * 25 + 5];
  const terrain = (x, y, z, scale, octaves = 4) => noise(x * scale + offset[0], y * scale + offset[1], z * scale + offset[2], octaves);
  const impactSites = type === 'barren' ? craters(seed) : [];
  const atmosphere = { terran: [74, 155, 231], ocean: [62, 145, 240], arid: [214, 154, 82], ice: [143, 216, 244], volcanic: [180, 51, 21] }[type];

  for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
    const x = (px + .5 - SIZE / 2) / RADIUS;
    const y = (py + .5 - SIZE / 2) / RADIUS;
    const radiusSquared = x * x + y * y;
    const index = (py * SIZE + px) * 4;
    if (radiusSquared >= 1) {
      if (atmosphere && radiusSquared < 1.09) {
        const distance = (Math.sqrt(radiusSquared) - 1) * RADIUS;
        const sunward = clamp(.45 - x * .36 - y * .30);
        pixels[index] = atmosphere[0]; pixels[index + 1] = atmosphere[1]; pixels[index + 2] = atmosphere[2];
        pixels[index + 3] = Math.round(65 * Math.exp(-distance / 1.65) * sunward);
      }
      continue;
    }

    const z = Math.sqrt(1 - radiusSquared);
    const light = Math.max(0, -.56 * x - .43 * y + .708 * z);
    const diffuse = .055 + .97 * light;
    const height = type === 'unknown' ? 0 : terrain(x, y, z, 2.65);
    const detail = type === 'unknown' ? 0 : terrain(x, y, z, 12, 2);
    let color, gloss = 0;

    if (type === 'terran') {
      const land = smooth(-.035, -.005, height);
      const elevation = smooth(.01, .26, height);
      const latitude = Math.abs(y * .93 + x * .18);
      const dry = smooth(.02, .23, terrain(x + 4, y, z, 3, 3) + .08 - Math.abs(latitude - .3) * .2);
      let earth = mix([39, 91, 53], [160, 135, 83], dry);
      earth = mix(earth, [146, 153, 140], elevation * .6);
      const water = mix([14, 42, 86], [30, 112, 133], smooth(-.19, -.025, height));
      color = mix(water, earth, land);
      color = mix(color, [209, 225, 218], smooth(.79, .96, latitude + height * .23));
      gloss = (1 - land) * .4;
    } else if (type === 'ocean') {
      const islandHeight = terrain(x, y, z, 4.8);
      const islands = smooth(.16, .19, islandHeight);
      const shallows = smooth(.04, .17, islandHeight);
      color = mix([11, 43, 101], [26, 143, 166], shallows);
      color = mix(color, mix([178, 180, 126], [41, 111, 78], smooth(.185, .24, islandHeight)), islands);
      gloss = (1 - islands) * .65;
    } else if (type === 'arid') {
      const basin = terrain(x - 3, y + 1, z, 4, 3);
      color = mix([121, 65, 37], [217, 168, 103], smooth(-.22, .22, height));
      color = mix(color, [236, 206, 147], smooth(.075, .24, basin) * .7);
      const rifts = 1 - smooth(.008, .04, Math.abs(terrain(x, y + 3, z, 4, 3)));
      color = mix(color, [87, 51, 37], rifts * smooth(-.08, .06, height) * .42);
    } else if (type === 'ice') {
      const fractures = 1 - smooth(.009, .03, Math.abs(terrain(x + 1, y, z, 5.8, 3)));
      const frost = smooth(-.21, .22, height + Math.abs(y) * .1);
      color = mix([88, 140, 170], [219, 238, 239], frost);
      color = mix(color, [37, 87, 119], fractures * .8);
      const fineFractures = 1 - smooth(.004, .013, Math.abs(terrain(x, y + 5, z, 13, 2)));
      color = mix(color, [111, 173, 196], fineFractures * .35);
      gloss = .13;
    } else if (type === 'volcanic') {
      color = mix([31, 30, 35], [77, 65, 60], smooth(-.2, .25, height));
      const fault = Math.abs(terrain(x, y + 2, z, 4.3, 3));
      const active = smooth(-.2, .07, terrain(x + 7, y, z, 2.7, 2));
      const fissure = (1 - smooth(.007, .032, fault)) * active;
      const core = (1 - smooth(.002, .012, fault)) * active;
      color = mix(color, [158, 48, 20], fissure * .7);
      color = color.map((channel, c) => channel * diffuse + [238, 57, 7][c] * fissure + [17, 109, 24][c] * core);
    } else if (type === 'barren') {
      color = mix([83, 84, 87], [162, 160, 151], smooth(-.25, .24, height));
      let relief = 1;
      for (const crater of impactSites) {
        const squaredDistance = (x - crater.x) ** 2 + (y - crater.y) ** 2 + (z - crater.z) ** 2;
        if (squaredDistance > crater.radius * crater.radius * 1.45) continue;
        const distance = Math.sqrt(squaredDistance) / crater.radius;
        const bowl = 1 - smooth(.38, .9, distance);
        const rim = Math.exp(-(((distance - .95) / .13) ** 2));
        const sunward = clamp(.5 - ((x - crater.x) * .65 + (y - crater.y) * .5) / crater.radius, -.25, 1.25);
        relief *= 1 - bowl * .34 + rim * (.08 + sunward * .28);
      }
      color = color.map(channel => channel * relief);
    } else {
      // The same featureless portrait for every unsurveyed system reveals no world data.
      color = [96, 108, 123];
    }

    if (type === 'terran' || type === 'ocean') {
      const curl = terrain(x + 5, y, z, 2, 2);
      const weather = terrain(x + curl * .22, y - curl * .35, z, 5.1, 4);
      const cloud = smooth(.045, .24, weather) * .85;
      color = mix(color, [226, 237, 241], cloud);
      gloss *= 1 - cloud;
    }

    const surfaceVariation = type === 'unknown' ? 1 : 1 + detail * (type === 'barren' ? .2 : .11);
    if (type !== 'volcanic') color = color.map(channel => channel * diffuse * surfaceVariation);
    const specular = Math.pow(clamp(-.31 * x - .24 * y + .92 * z), 54) * gloss * 155;
    if (gloss) color = color.map(channel => channel + specular);
    if (atmosphere) {
      const limb = Math.pow(1 - z, 3.1) * (.12 + light * .57) * (type === 'volcanic' ? .25 : 1);
      color = mix(color, atmosphere, limb);
    }
    // Subpixel edge coverage avoids a hard, stair-stepped silhouette at small UI sizes.
    const coverage = clamp((1 - Math.sqrt(radiusSquared)) * RADIUS + .4);
    pixels[index] = clamp(color[0], 0, 255);
    pixels[index + 1] = clamp(color[1], 0, 255);
    pixels[index + 2] = clamp(color[2], 0, 255);
    pixels[index + 3] = Math.round(coverage * 255);
  }
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Return a cached 320px PNG portrait. Call with { type: 'unknown' } before survey.
 * Geography depends only on the system's identity and type, so changes to economy
 * or habitability do not unexpectedly redraw a settled world's continents.
 */
export function planetImage(system = {}) {
  const type = supported.has(system.type) ? system.type : 'unknown';
  const identity = type === 'unknown' ? 'unknown' : `${system.seed ?? ''}|${system.id ?? ''}|${system.name ?? ''}|${type}`;
  if (images.has(identity)) {
    const result = images.get(identity);
    images.delete(identity); images.set(identity, result);
    return result;
  }
  const result = paint(type, hash(identity));
  images.set(identity, result);
  if (images.size > MAX_IMAGES) images.delete(images.keys().next().value);
  return result;
}
