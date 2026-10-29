import * as THREE from 'three';

/**
 * Static native-geometry portraits, rendered only on a cache miss.
 * shipImage(type, { color, ancient }) -> transparent 512 × 320 PNG data URL.
 * One lazy WebGL context; 24-image LRU. No animation, asset requests or timers.
 * Per-portrait geometry/materials are disposed immediately after capture. A
 * Canvas2D painter projects the same hull if WebGL is unavailable or lost.
 * Browser-only, like planet-art.js. Unknown classes use the scout silhouette.
 */
const WIDTH = 512;
const HEIGHT = 320;
const CACHE_LIMIT = 24;
const TYPES = new Set(['scout', 'colony', 'frigate', 'cruiser']);
const images = new Map();
let renderer = null;
let webglUnavailable = false;
let paintCanvas = null;

function normalizedColor(value) {
  if (typeof value !== 'string') return '#76d7c4';
  const hex = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map(c => c + c).join('')}`;
  return '#76d7c4';
}

function palette(color, ancient) {
  const standard = (hex, roughness = .48, metalness = .48) => new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
  const light = (hex, intensity = 1) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: .35, metalness: .2 });
  return {
    hull: standard(ancient ? '#65767c' : '#8399ac'),
    pale: standard(ancient ? '#bcb49b' : '#d3d4c8', .52, .32),
    panel: standard(ancient ? '#3b5158' : '#455d73', .58),
    dark: standard('#172b3b', .65, .35),
    edge: standard(ancient ? '#d2b772' : '#bacad3', .3, .65),
    accent: standard(color, .38, .4),
    trim: standard(ancient ? '#bf9657' : '#738d9d', .4, .65),
    glass: light(ancient ? '#6d9ea2' : '#398baf', .22),
    lamp: light(ancient ? '#efcf91' : '#c0e7e7', .65),
    engine: light(ancient ? '#c8adee' : '#8ed8f3', 1.5),
  };
}

function buildShip(type, color, ancient) {
  const group = new THREE.Group();
  const p = palette(color, ancient);
  const geometries = new Map();
  const geometry = (key, factory) => {
    if (!geometries.has(key)) geometries.set(key, factory());
    return geometries.get(key);
  };
  const mesh = (shape, material, x = 0, y = 0, z = 0) => {
    const result = new THREE.Mesh(shape, material);
    result.position.set(x, y, z);
    result.castShadow = result.receiveShadow = true;
    group.add(result);
    return result;
  };
  const box = (x, y, z, sx, sy, sz, material = p.hull) => {
    const result = mesh(geometry('box', () => new THREE.BoxGeometry(1, 1, 1)), material, x, y, z);
    result.scale.set(sx, sy, sz);
    return result;
  };
  const sphere = (x, y, z, sx, sy, sz, material = p.pale) => {
    const result = mesh(geometry('sphere', () => new THREE.SphereGeometry(1, 16, 10)), material, x, y, z);
    result.scale.set(sx, sy, sz);
    return result;
  };
  const cylinder = (x, y, z, radius, length, material = p.hull, axis = 'x', endRadius = radius) => {
    const shape = geometry(`cylinder:${radius}:${endRadius}:${length}`, () => new THREE.CylinderGeometry(endRadius, radius, length, 16));
    const result = mesh(shape, material, x, y, z);
    if (axis === 'x') result.rotation.z = -Math.PI / 2;
    if (axis === 'z') result.rotation.x = Math.PI / 2;
    return result;
  };
  const ring = (x, y, z, radius, thickness, material = p.edge, axis = 'x') => {
    const shape = geometry(`ring:${radius}:${thickness}`, () => new THREE.TorusGeometry(radius, thickness, 8, 32));
    const result = mesh(shape, material, x, y, z);
    if (axis === 'x') result.rotation.y = Math.PI / 2;
    if (axis === 'y') result.rotation.x = Math.PI / 2;
    return result;
  };
  const hull = (outline, height, bottom = 0, material = p.hull, bevel = .065) => {
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const result = mesh(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelSegments: 1, steps: 1, bevelSize: bevel, bevelThickness: bevel }), material, 0, bottom, 0);
    result.rotation.x = -Math.PI / 2;
    return result;
  };
  const strut = (from, to, width = .09, material = p.edge) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const result = box(...a.clone().add(b).multiplyScalar(.5).toArray(), width, a.distanceTo(b), width, material);
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    return result;
  };
  const engine = (x, y, z, radius, length) => {
    cylinder(x, y, z, radius, length, p.panel);
    cylinder(x + length * .22, y, z, radius * 1.08, length * .28, p.hull);
    cylinder(x - length * .46, y, z, radius * .93, .1, p.dark);
    ring(x - length * .52, y, z, radius * .73, radius * .16, p.edge);
    cylinder(x - length * .55, y, z, radius * .58, .035, p.engine);
    for (let side = -1; side <= 1; side += 2) box(x, y + radius * .91, z + side * radius * .35, length * .63, .045, radius * .18, p.trim);
  };
  const windows = (x, y, z, count, step = .22, axis = 'x') => {
    for (let i = 0; i < count; i++) box(x + (axis === 'x' ? i * step : 0), y, z + (axis === 'z' ? i * step : 0), axis === 'x' ? .085 : .035, .045, axis === 'z' ? .085 : .035, p.lamp);
  };
  const radiator = (x, y, z, count = 5) => {
    box(x, y, z, .85, .09, .5, p.dark);
    for (let i = 0; i < count; i++) box(x - .34 + i * .17, y + .045, z, .055, .08, .45, p.trim);
  };
  const turret = (x, y, z, heavy = false) => {
    cylinder(x, y, z, heavy ? .23 : .16, .09, p.dark, 'y');
    box(x + .015, y + .09, z, heavy ? .43 : .29, .16, heavy ? .32 : .24, p.hull);
    for (const side of [-1, 1]) cylinder(x + (heavy ? .43 : .31), y + .12, z + side * (heavy ? .105 : .065), heavy ? .04 : .027, heavy ? .65 : .43, p.edge);
  };

  if (type === 'scout') {
    // A light needle, broad sensor vanes, and two exposed outrider drives.
    hull([[2.7, 0], [1.18, -.32], [-1.45, -.35], [-1.9, 0], [-1.45, .35], [1.18, .32]], .28, -.12);
    hull([[1.65, 0], [.55, -.26], [-.45, -.22], [-.6, .22], [.55, .26]], .2, .2, p.panel, .04);
    hull([[1.3, 0], [.55, -.18], [.1, -.16], [.1, .16], [.55, .18]], .07, .42, p.glass, .015);
    for (const side of [-1, 1]) {
      hull([[.25, side * .25], [-.7, side * 1.7], [-1.8, side * 1.47], [-1.15, side * .24]], .1, -.04, p.panel, .035);
      hull([[-.1, side * .39], [-.79, side * 1.44], [-1.05, side * 1.34], [-.58, side * .35]], .035, .095, p.accent, .015);
      engine(-1.3, -.02, side * 1.33, .19, 1.2);
      strut([.35, .18, side * .27], [.15, .28, side * 1.5], .045, p.edge);
      cylinder(.15, .28, side * 1.5, .07, .52, p.edge);
    }
    box(-.75, .26, 0, .8, .06, .15, p.accent);
    radiator(-.77, .26, 0, 4);
    strut([-.15, .4, 0], [-.38, .85, 0], .045);
    sphere(-.38, .85, 0, .07, .045, .16, p.edge);
    windows(.15, .36, .25, 3, .23);
  } else if (type === 'colony') {
    // A civilian ark: a broad habitat wheel, rounded life-support modules and
    // externally carried settlement packages. No weapon or military bow.
    cylinder(0, 0, 0, .43, 4.4, p.pale);
    sphere(2.12, 0, 0, .63, .46, .46, p.pale);
    sphere(2.55, .12, 0, .17, .22, .31, p.glass);
    box(.7, .47, 0, 1.05, .19, .46, p.pale);
    box(.94, .59, 0, .5, .07, .36, p.glass);
    ring(.18, 0, 0, 1.18, .21, p.pale);
    ring(.18, 0, 0, 1.18, .08, p.accent);
    ring(.42, 0, 0, 1.16, .045, p.edge);
    ring(-.06, 0, 0, 1.16, .045, p.edge);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle);
      strut([.18, c * .38, s * .38], [.18, c * 1.1, s * 1.1], .09, p.trim);
      sphere(.18, c * 1.18, s * 1.18, .17, .13, .13, p.glass);
    }
    for (const side of [-1, 1]) {
      box(-1.15, -.18, side * .67, 1.7, .28, .18, p.dark);
      for (let i = 0; i < 3; i++) {
        const x = -1.72 + i * .58;
        box(x, -.02, side * .76, .48, .65, .5, p.pale);
        box(x, .32, side * .76, .48, .055, .43, p.accent);
        box(x, -.02, side * 1.02, .13, .54, .035, p.trim);
      }
      engine(-2.05, -.07, side * .75, .26, .82);
      sphere(1.13, -.4, side * .58, .68, .3, .3, p.pale);
      ring(1.15, -.4, side * .58, .285, .045, p.trim);
    }
    cylinder(-2.2, 0, 0, .41, .36, p.panel);
    cylinder(-2.4, 0, 0, .28, .035, p.engine);
    windows(.8, .29, .37, 5, .24);
  } else if (type === 'frigate') {
    // A narrow escort with a raised command spine and two armored drive pods.
    hull([[3.15, 0], [2.1, -.48], [.4, -.62], [-1.65, -.47], [-2.25, -.25], [-2.25, .25], [-1.65, .47], [.4, .62], [2.1, .48]], .44, -.2);
    hull([[2.77, 0], [1.7, -.32], [-1.35, -.34], [-1.7, .34], [1.7, .32]], .18, .29, p.panel, .055);
    hull([[2.5, 0], [1.45, -.1], [-.7, -.1], [-.7, .1], [1.45, .1]], .04, .53, p.accent, .02);
    for (const side of [-1, 1]) {
      hull([[.1, side * .4], [-.7, side * 1.11], [-2.25, side * 1.0], [-1.6, side * .35]], .18, -.12, p.panel);
      engine(-1.65, -.04, side * .94, .33, 1.65);
      box(-1.15, .31, side * .96, .65, .07, .27, p.accent);
      for (let i = 0; i < 4; i++) box(.15 + i * .37, .11, side * .57, .23, .17, .13, p.edge);
      radiator(-.8, .5, side * .36, 4);
      turret(.55, .36, side * .52);
    }
    box(-.55, .64, 0, .7, .28, .47, p.hull);
    box(-.35, .85, 0, .68, .12, .55, p.panel);
    box(-.19, .88, 0, .36, .065, .57, p.glass);
    turret(1.42, .56, 0);
    strut([-.87, .71, 0], [-1.02, 1.15, 0], .055);
    box(-1.02, 1.15, 0, .08, .05, .46, p.edge);
    windows(-.58, .76, .25, 3, .18);
  } else {
    // A capital ship with a broad hammerhead, layered armored shoulders,
    // four drives and a stepped command citadel. Its mass reads at icon scale.
    hull([[3.0, -.83], [2.45, -1.36], [1.65, -1.32], [1.3, -.82], [-1.7, -.9], [-2.5, -.58], [-2.5, .58], [-1.7, .9], [1.3, .82], [1.65, 1.32], [2.45, 1.36], [3.0, .83]], .58, -.29, p.hull, .09);
    hull([[2.82, -.7], [2.34, -1.16], [1.8, -1.1], [1.52, -.59], [-1.7, -.64], [-2.1, .64], [1.52, .59], [1.8, 1.1], [2.34, 1.16], [2.82, .7]], .19, .36, p.panel, .05);
    hull([[2.7, -.28], [1.5, -.34], [-1.8, -.34], [-1.8, .34], [1.5, .34], [2.7, .28]], .12, .59, p.hull, .04);
    box(2.51, .59, 0, .24, .06, 1.72, p.accent);
    for (const side of [-1, 1]) {
      for (const z of [.42, .95]) engine(-2.07, -.11, side * z, z < .5 ? .29 : .36, 1.25);
      hull([[1.32, side * .64], [.64, side * 1.07], [-1.72, side * 1.1], [-2.1, side * .76]], .22, .12, p.hull, .045);
      box(-.7, .41, side * 1.0, 1.25, .045, .1, p.accent);
      radiator(-1.4, .6, side * .59, 5);
      for (let i = 0; i < 3; i++) turret(-.65 + i * .72, .57, side * .72, i === 2);
      for (let i = 0; i < 6; i++) box(-1.6 + i * .48, -.08, side * .92, .29, .17, .07, p.dark);
      windows(-.2, .32, side * 1.14, 5, .25);
    }
    box(-.58, .86, 0, 1.28, .27, .68, p.panel);
    box(-.61, 1.08, 0, .85, .21, .55, p.hull);
    box(-.49, 1.25, 0, .75, .13, .78, p.panel);
    box(-.32, 1.28, 0, .4, .075, .8, p.glass);
    turret(1.23, .78, 0, true);
    strut([-1, 1.16, 0], [-1.22, 1.64, 0], .065);
    box(-1.22, 1.64, 0, .09, .06, .55, p.edge);
    windows(-.87, 1.24, .41, 4, .18);
  }

  if (ancient) {
    // A material/architectural lineage, not an implied change of ship class.
    const span = type === 'scout' ? .37 : type === 'colony' ? .48 : .64;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) box(.3 + i * .32, type === 'colony' ? .41 : type === 'cruiser' ? .73 : .5, side * span * .45, .055, .045, span * .45, p.trim);
    }
    sphere(-.15, type === 'cruiser' ? 1.15 : type === 'colony' ? .48 : .53, 0, .11, .07, .11, p.engine);
  }
  group.userData.materials = Object.values(p);
  group.updateMatrixWorld(true);
  return group;
}

function cameraFor(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-4, 4, 2.5, -2.5, .1, 100);
  camera.position.copy(center).add(new THREE.Vector3(8, 6.5, 10));
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const view = new THREE.Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) view.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  const aspect = WIDTH / HEIGHT;
  const halfHeight = Math.max((view.max.y - view.min.y) / 2, (view.max.x - view.min.x) / (2 * aspect)) * 1.09;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  return camera;
}

function getRenderer() {
  if (renderer || webglUnavailable) return renderer;
  const canvas = document.createElement('canvas');
  const attributes = { alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' };
  const context = canvas.getContext('webgl2', attributes);
  if (!context) { webglUnavailable = true; return null; }
  renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    webglUnavailable = true;
    renderer = null;
  });
  return renderer;
}

function renderWebGL(model, camera) {
  const activeRenderer = getRenderer();
  if (!activeRenderer) return null;
  const scene = new THREE.Scene();
  scene.add(model, new THREE.HemisphereLight('#c5e1f2', '#233047', 1.05));
  let keyLight;
  for (const [color, intensity, position] of [
    ['#e2efff', 2.8, [-3, 8, 6]],
    ['#8ca9d9', 1.25, [3, 3, -7]],
    ['#ffe2b7', 2.1, [-6, 4, -3]],
  ]) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    if (!keyLight) {
      keyLight = light;
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      Object.assign(light.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: .1, far: 30 });
      light.shadow.bias = -.0002;
      light.shadow.normalBias = .018;
    }
    scene.add(light);
  }
  try {
    activeRenderer.render(scene, camera);
    return activeRenderer.domElement.toDataURL('image/png');
  } finally {
    keyLight.shadow.dispose();
    // Renderer render lists otherwise retain the most recently rendered scene.
    activeRenderer.renderLists.dispose();
    scene.remove(model);
  }
}

function renderCanvas(model, camera) {
  paintCanvas ||= Object.assign(document.createElement('canvas'), { width: WIDTH, height: HEIGHT });
  const context = paintCanvas.getContext('2d');
  context.clearRect(0, 0, WIDTH, HEIGHT);
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const light = new THREE.Vector3(-3, 8, 6).normalize();
  const triangles = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), center = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const facing = new THREE.Vector3();
  model.traverse(part => {
    if (!part.isMesh) return;
    const positions = part.geometry.attributes.position;
    const indices = part.geometry.index;
    const count = indices ? indices.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(positions, indices ? indices.getX(i) : i).applyMatrix4(part.matrixWorld);
      b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(part.matrixWorld);
      c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(part.matrixWorld);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      if (normal.dot(facing.subVectors(camera.position, center)) <= 0) continue;
      const material = part.material;
      const brightness = .38 + Math.max(0, normal.dot(light)) * .87;
      const color = material.color.clone().multiplyScalar(brightness);
      if (material.emissive) color.add(material.emissive.clone().multiplyScalar(material.emissiveIntensity * .55));
      const depth = center.applyMatrix4(camera.matrixWorldInverse).z;
      const points = [a, b, c].map(point => {
        point.applyMatrix4(projection);
        return [(point.x * .5 + .5) * WIDTH, (-point.y * .5 + .5) * HEIGHT];
      });
      triangles.push({ points, depth, color: color.getStyle() });
    }
  });
  triangles.sort((a, b) => a.depth - b.depth);
  context.lineJoin = 'round';
  context.lineWidth = .45;
  for (const { points, color } of triangles) {
    context.beginPath();
    context.moveTo(...points[0]);
    context.lineTo(...points[1]);
    context.lineTo(...points[2]);
    context.closePath();
    context.fillStyle = context.strokeStyle = color;
    context.fill();
    context.stroke();
  }
  return paintCanvas.toDataURL('image/png');
}

function disposeModel(model) {
  const geometries = new Set();
  model.traverse(part => { if (part.geometry) geometries.add(part.geometry); });
  for (const geometry of geometries) geometry.dispose();
  for (const material of model.userData.materials) material.dispose();
}

export function shipImage(type, { color = '#76d7c4', ancient = false } = {}) {
  type = TYPES.has(type) ? type : 'scout';
  color = normalizedColor(color);
  ancient = Boolean(ancient);
  const key = `${type}:${color}:${ancient}`;
  if (images.has(key)) {
    const image = images.get(key);
    images.delete(key);
    images.set(key, image);
    return image;
  }
  const model = buildShip(type, color, ancient);
  let image;
  try {
    const camera = cameraFor(model);
    try { image = renderWebGL(model, camera); }
    catch {
      webglUnavailable = true;
      renderer?.dispose();
      renderer = null;
    }
    image ||= renderCanvas(model, camera);
  } finally {
    disposeModel(model);
  }
  images.set(key, image);
  if (images.size > CACHE_LIMIT) images.delete(images.keys().next().value);
  return image;
}
