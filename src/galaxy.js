import * as THREE from 'three';
import { FACTIONS, PLANET_TYPES, SHIPS } from './content.js';
import './galaxy.css';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const ownedColor = owner => FACTIONS[owner]?.color || '#bbcadb';
const visited = system => system.exploredBy?.includes('player');
const known = system => system.knownBy?.includes('player') || visited(system) || system.owner === 'player';
const rnd = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let n = Math.imul(seed ^ seed >>> 15, 1 | seed); n ^= n + Math.imul(n ^ n >>> 7, 61 | n); return ((n ^ n >>> 14) >>> 0) / 4294967296; };

function texture(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d'), size);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  return result;
}

function glowTexture() {
  return texture(128, (ctx, size) => {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.035, '#ffffff');
    g.addColorStop(.09, 'rgba(255,255,255,.95)');
    g.addColorStop(.21, 'rgba(255,255,255,.24)');
    g.addColorStop(.53, 'rgba(255,255,255,.055)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  });
}

function cloudTexture() {
  return texture(512, (ctx, size) => {
    const random = rnd(9148);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 58; i++) {
      const a = random() * Math.PI * 2, d = Math.sqrt(random()) * 115;
      const x = size / 2 + Math.cos(a) * d * 1.2, y = size / 2 + Math.sin(a) * d * .7;
      const radius = 38 + random() * 98;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(255,255,255,${.04 + random() * .035})`);
      g.addColorStop(.45, 'rgba(255,255,255,.025)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

function circle(radius, color, opacity = .4, segments = 72, start = 0, end = Math.PI * 2) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + i / segments * (end - start);
    points.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
}

/** A self-contained galaxy map. All commands and simulation remain in the UI. */
export class GalaxyView {
  constructor(container, { onSelect = () => {}, onFleetSelect = () => {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onFleetSelect = onFleetSelect;
    this.state = null;
    this.selectedSystemId = null;
    this.selectedFleetId = null;
    this.disposed = false;
    this.paused = false;
    this.surfaceVisible = false;
    this.viewportVisible = true;
    this.needsRender = true;
    this.labelsDirty = true;
    this.lastRenderTime = 0;
    this.animate = this.animate.bind(this);
    this.width = 1; this.height = 1;
    this.baseHeight = 800;
    this.unit = 7;
    this.mapCenter = new THREE.Vector2();
    this.target = new THREE.Vector2();
    this.targetZoom = 1;
    this.camera = new THREE.OrthographicCamera(-400, 400, 400, -400, .1, 2000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#080e1b');
    this.staticGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    this.scene.add(this.staticGroup, this.dynamicGroup);
    this.hitTargets = [];
    this.labels = [];
    this.selectionRings = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.projected = new THREE.Vector3();
    this.resources = new Set();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.abort = new AbortController();
    this.container.classList.add('galaxy-view');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'galaxy-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.container.append(this.canvas);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'galaxy-labels';
    this.labelLayer.setAttribute('aria-label', 'Galaxy systems and fleets');
    this.container.append(this.labelLayer);
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'galaxy-tooltip';
    this.tooltip.hidden = true;
    this.container.append(this.tooltip);
    this.backdropLabel = document.createElement('div');
    this.backdropLabel.className = 'galaxy-sector-label';
    this.backdropLabel.innerHTML = '<span>THE ASTERION REACH</span><small>THE UNCHARTED EXPANSE</small>';
    this.container.append(this.backdropLabel);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor('#080e1b');
      this.glow = glowTexture(); this.cloud = cloudTexture();
      this.resources.add(this.glow); this.resources.add(this.cloud);
    } catch (error) {
      this.fallback = true;
      this.canvas.hidden = true;
      this.container.classList.add('galaxy-fallback');
      this.fallbackNotice = document.createElement('p');
      this.fallbackNotice.className = 'galaxy-fallback-notice';
      this.fallbackNotice.textContent = 'WebGL is unavailable. The tactical star chart remains playable. Enable hardware acceleration for the full galaxy view.';
      this.container.append(this.fallbackNotice);
    }
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.viewportVisible = entry.isIntersecting;
      if (!this.viewportVisible) this.cancelScheduledFrame();
      else this.resize();
    });
    this.intersectionObserver.observe(container);
    this.resize();
    this.lastTime = 0;
    this.requestFrame();
  }

  bindEvents() {
    const { signal } = this.abort;
    this.container.addEventListener('pointerdown', event => {
      if (event.target.closest('button, a') || event.button > 1) return;
      this.drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
      this.container.setPointerCapture(event.pointerId);
    }, { signal });
    this.container.addEventListener('pointermove', event => {
      if (this.drag) {
        const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
        this.drag.moved ||= Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 5;
        if (this.drag.moved) {
          const scale = this.baseHeight / this.camera.zoom / this.height;
          this.target.x -= dx * scale; this.target.y += dy * scale;
          this.camera.position.x = this.target.x; this.camera.position.y = this.target.y;
          this.labelsDirty = true;
          this.container.classList.add('galaxy-dragging');
          this.requestFrame();
        }
        this.drag.x = event.clientX; this.drag.y = event.clientY;
        this.tooltip.hidden = true;
      } else if (event.target === this.canvas) {
        const id = this.pick(event);
        this.container.classList.toggle('galaxy-pointing', Boolean(id));
        this.showTooltip(id, event);
      }
    }, { signal });
    this.container.addEventListener('pointerup', event => {
      if (!this.drag) return;
      if (!this.drag.moved) {
        const id = this.pick(event);
        if (id) this.onSelect(id);
      }
      this.drag = null;
      this.container.classList.remove('galaxy-dragging');
      if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId);
    }, { signal });
    this.container.addEventListener('pointercancel', () => {
      this.drag = null; this.container.classList.remove('galaxy-dragging');
    }, { signal });
    this.container.addEventListener('pointerleave', () => { this.tooltip.hidden = true; }, { signal });
    this.container.addEventListener('dblclick', event => {
      if (event.target.closest('button, a')) return;
      const id = this.pick(event);
      if (id) this.focus(id);
    }, { signal });
    this.container.addEventListener('wheel', event => {
      if (event.target.closest('button, a')) return;
      event.preventDefault();
      this.zoom(-Math.sign(event.deltaY) * .14);
    }, { passive: false, signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancelScheduledFrame();
      else this.requestFrame();
    }, { signal });
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.contextLost = true;
      this.cancelScheduledFrame();
      if (!this.contextNotice) {
        this.contextNotice = document.createElement('p');
        this.contextNotice.className = 'galaxy-fallback-notice';
        this.contextNotice.textContent = 'The graphics context was interrupted. Your game is safe; reload to restore the galaxy.';
        this.container.append(this.contextNotice);
      }
    }, { signal });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.contextNotice?.remove(); this.contextNotice = null;
      this.requestFrame();
    }, { signal });
  }

  resize() {
    if (this.disposed) return;
    const width = this.container.clientWidth, height = this.container.clientHeight;
    this.surfaceVisible = width > 0 && height > 0;
    if (!this.surfaceVisible) {
      // A hidden page reports zero dimensions. Keep the last useful projection
      // rather than resizing the drawing buffer and camera to a 1px square.
      this.cancelScheduledFrame();
      return;
    }
    if (width !== this.width || height !== this.height || !this.hasMeasuredSize) this.renderer?.setSize(width, height, false);
    this.width = width; this.height = height;
    const aspect = this.width / this.height;
    if (!this.hasMeasuredSize && this.boundsWidth !== undefined) this.baseHeight = Math.max(this.boundsHeight * 1.22, this.boundsWidth / Math.max(.7, aspect) * 1.22, 100);
    this.hasMeasuredSize = true;
    this.camera.left = -this.baseHeight * aspect / 2;
    this.camera.right = this.baseHeight * aspect / 2;
    this.camera.top = this.baseHeight / 2;
    this.camera.bottom = -this.baseHeight / 2;
    this.camera.updateProjectionMatrix();
    this.labelsDirty = true;
    this.requestFrame();
  }

  world(system) { return new THREE.Vector3(system.x, -system.y, 0); }

  setBounds(state) {
    const xs = state.systems.map(s => s.x), ys = state.systems.map(s => -s.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    this.boundsWidth = maxX - minX; this.boundsHeight = maxY - minY;
    this.span = Math.max(maxX - minX, maxY - minY, 100);
    this.unit = this.span / 110;
    this.mapCenter.set((minX + maxX) / 2, (minY + maxY) / 2);
    this.baseHeight = Math.max((maxY - minY) * 1.22, (maxX - minX) / Math.max(.7, this.width / this.height) * 1.22, 100);
    this.target.copy(this.mapCenter);
    this.camera.position.x = this.target.x; this.camera.position.y = this.target.y;
    this.camera.zoom = this.targetZoom = 1;
    this.resize();
    this.clearGroup(this.staticGroup);
    if (!this.fallback) this.buildBackground();
  }

  buildBackground() {
    const random = rnd(737190), positions = [], colors = [];
    const starColor = new THREE.Color();
    for (let i = 0; i < 2500; i++) {
      const arm = i % 3;
      const distance = Math.pow(random(), .65) * this.span * .72;
      const angle = arm * Math.PI * 2 / 3 + distance / this.span * 5.5 + (random() - .5) * 1.2;
      const inArm = i < 1600;
      const x = inArm ? Math.cos(angle) * distance : (random() - .5) * this.span * 2.8;
      const y = inArm ? Math.sin(angle) * distance * .72 : (random() - .5) * this.span * 2.8;
      positions.push(this.mapCenter.x + x, this.mapCenter.y + y, -70 - random() * 30);
      starColor.setHSL(.55 + random() * .18, .1 + random() * .25, .20 + random() * .42);
      colors.push(starColor.r, starColor.g, starColor.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2.1, sizeAttenuation: false, map: this.glow, vertexColors: true, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.staticGroup.add(stars);
    const clouds = [
      [-.25, -.04, '#445a93', .6, .92, .5, -.3],
      [.07, .14, '#654285', .5, .9, .5, .4],
      [.3, -.22, '#236578', .32, .9, .6, -.8],
      [-.13, -.4, '#325567', .3, .8, .45, .5],
      [.05, -.06, '#53658f', .17, .58, .36, -.7],
    ];
    for (const [x, y, color, opacity, w, h, rotation] of clouds) {
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloud, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, rotation }));
      cloud.position.set(this.mapCenter.x + x * this.span, this.mapCenter.y + y * this.span, -50);
      cloud.scale.set(this.span * w * 1.8, this.span * h * 1.8, 1);
      this.staticGroup.add(cloud);
    }
    // Sparse cartographic reference rings make the scale readable without a grid.
    for (let i = 1; i <= 3; i++) {
      const ring = circle(this.span * .16 * i, '#8195b8', .035, 128);
      ring.position.set(this.mapCenter.x, this.mapCenter.y, -35);
      this.staticGroup.add(ring);
    }
  }

  update(state, selectedSystemId = null, selectedFleetId = null) {
    if (this.disposed || !state?.systems?.length) return;
    const galaxyChanged = !this.state || this.galaxySeed !== state.seed || this.systemSignature !== state.systems.map(s => `${s.id}:${s.x},${s.y}`).join('|');
    this.state = state;
    this.galaxySeed = state.seed;
    this.systemSignature = state.systems.map(s => `${s.id}:${s.x},${s.y}`).join('|');
    this.selectedSystemId = selectedSystemId;
    this.selectedFleetId = selectedFleetId;
    this.systemsById = new Map(state.systems.map(s => [s.id, s]));
    if (galaxyChanged) this.setBounds(state);
    this.clearGroup(this.dynamicGroup);
    this.labelLayer.replaceChildren();
    this.labels = []; this.hitTargets = []; this.selectionRings = [];
    const selectedFleet = state.fleets?.find(f => f.id === selectedFleetId);
    const neighbors = new Set();
    if (selectedFleet?.owner === 'player') for (const lane of state.lanes || []) {
      if (lane[0] === selectedFleet.systemId) neighbors.add(lane[1]);
      if (lane[1] === selectedFleet.systemId) neighbors.add(lane[0]);
    }
    if (!this.fallback) this.buildLanes(state, selectedFleet, neighbors);
    for (const system of state.systems) {
      const charted = known(system), surveyed = visited(system), position = this.world(system);
      const isSelected = system.id === selectedSystemId;
      if (!this.fallback) this.buildStar(system, position, charted, surveyed, isSelected, neighbors.has(system.id));
      if (charted) this.buildLabel(system, position, surveyed, isSelected, neighbors.has(system.id));
    }
    this.buildFleetLabels(state);
    this.sortedLabels = [...this.labels].sort((a, b) => b.priority - a.priority);
    this.labelsDirty = true;
    this.requestFrame();
  }

  buildLanes(state, selectedFleet, neighbors) {
    const buckets = { unknown: [], known: [], owned: [], reachable: [] };
    for (const [a, b] of state.lanes || []) {
      const sa = this.systemsById.get(a), sb = this.systemsById.get(b);
      if (!sa || !sb) continue;
      const bothKnown = known(sa) && known(sb);
      // Unknown connections remain hidden; undiscovered stars are ambient points only.
      if (!bothKnown) continue;
      const route = selectedFleet && (a === selectedFleet.systemId && neighbors.has(b) || b === selectedFleet.systemId && neighbors.has(a));
      const key = route ? 'reachable' : sa.owner === 'player' && sb.owner === 'player' ? 'owned' : 'known';
      const pa = this.world(sa), pb = this.world(sb);
      const direction = pb.clone().sub(pa).normalize().multiplyScalar(this.unit * 1.35);
      pa.add(direction); pb.sub(direction);
      buckets[key].push(pa.x, pa.y, -.5, pb.x, pb.y, -.5);
    }
    const style = { known: ['#6c849a', .28], owned: ['#68d9cd', .5], reachable: ['#a0eee0', .8], unknown: ['#67738d', .08] };
    for (const [key, values] of Object.entries(buckets)) if (values.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
      const [color, opacity] = style[key];
      this.dynamicGroup.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false })));
    }
  }

  buildStar(system, position, charted, surveyed, selected, reachable) {
    const owner = surveyed || system.owner === 'player' ? system.owner : null;
    const color = owner ? ownedColor(owner) : surveyed ? PLANET_TYPES[system.type]?.color || '#e4d6bd' : '#c4d3e5';
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, opacity: charted ? 1 : .22, blending: THREE.AdditiveBlending, depthWrite: false }));
    star.position.copy(position); star.position.z = 1;
    const size = this.unit * (charted ? owner ? 5.3 : 4.0 : 1.6);
    star.scale.set(size, size, 1);
    this.dynamicGroup.add(star);
    if (!charted) return;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(this.unit * 1.4, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(position); hit.userData.systemId = system.id;
    this.hitTargets.push(hit); this.dynamicGroup.add(hit);
    if (owner) {
      const territory = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: ownedColor(owner), transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false }));
      territory.position.copy(position); territory.position.z = -2;
      territory.scale.set(this.unit * 17, this.unit * 17, 1);
      this.dynamicGroup.add(territory);
      const orbit = circle(this.unit * 2.3, color, .36, 56);
      orbit.position.copy(position); this.dynamicGroup.add(orbit);
      const orbital = new THREE.Mesh(new THREE.CircleGeometry(this.unit * .19, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 }));
      orbital.position.set(position.x + this.unit * 2.3, position.y, .5);
      this.dynamicGroup.add(orbital);
    }
    if (reachable && system.id !== this.selectedSystemId) {
      const ring = circle(this.unit * 1.7, '#8fe6d8', .55, 40, .25, Math.PI * 1.8);
      ring.position.copy(position); this.dynamicGroup.add(ring);
    }
    if (selected) {
      for (let i = 0; i < 4; i++) {
        const arc = circle(this.unit * 3.1, '#b6f4e9', .9, 15, Math.PI / 2 * i + .12, Math.PI / 2 * i + .75);
        arc.position.copy(position); arc.position.z = 2;
        this.dynamicGroup.add(arc); this.selectionRings.push(arc);
      }
      const outer = circle(this.unit * 3.7, '#68d9cd', .13);
      outer.position.copy(position); this.dynamicGroup.add(outer);
    }
    if (surveyed && system.anomaly && !system.anomaly.resolved) {
      const points = [new THREE.Vector3(0, this.unit * .5, 0), new THREE.Vector3(this.unit * .35, 0, 0), new THREE.Vector3(0, -this.unit * .5, 0), new THREE.Vector3(-this.unit * .35, 0, 0), new THREE.Vector3(0, this.unit * .5, 0)];
      const marker = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#e9bb76' }));
      marker.position.set(position.x - this.unit * 2.5, position.y + this.unit * 2.5, 2);
      this.dynamicGroup.add(marker);
    }
  }

  buildLabel(system, position, surveyed, selected, reachable) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `galaxy-system-label${selected ? ' is-selected' : ''}${system.owner === 'player' ? ' is-owned' : ''}${!surveyed ? ' is-unsurveyed' : ''}${reachable ? ' is-reachable' : ''}`;
    element.dataset.systemId = system.id;
    element.style.setProperty('--system-color', surveyed && system.owner ? ownedColor(system.owner) : '#bac8d9');
    element.setAttribute('aria-pressed', String(selected));
    const name = document.createElement('span'); name.className = 'galaxy-system-name'; name.textContent = system.name;
    element.append(name);
    const status = document.createElement('small'); status.className = 'galaxy-system-status';
    status.textContent = !surveyed ? 'UNSURVEYED' : system.owner ? FACTIONS[system.owner]?.shortName?.toUpperCase() || 'COLONY' : system.anomaly && !system.anomaly.resolved ? '◇ ANOMALY' : PLANET_TYPES[system.type]?.name?.toUpperCase() || 'SURVEYED';
    element.append(status);
    element.setAttribute('aria-label', `${system.name}, ${status.textContent.toLowerCase()}${reachable ? ', adjacent to selected fleet' : ''}`);
    element.addEventListener('click', event => { event.stopPropagation(); this.onSelect(system.id); });
    element.addEventListener('dblclick', event => { event.stopPropagation(); this.focus(system.id); });
    this.labelLayer.append(element);
    this.labels.push({ element, position, kind: 'system', systemId: system.id, offsetX: 0, offsetY: 16, priority: selected ? 100 : system.owner === 'player' ? 80 : 40 });
  }

  buildFleetLabels(state) {
    const orbitCounts = new Map();
    for (const fleet of state.fleets || []) {
      const system = this.systemsById.get(fleet.systemId);
      if (!system || !known(system)) continue;
      // Foreign ships are visible only where a player colony or fleet has sensors.
      const sensorPresent = system.owner === 'player' || state.fleets.some(f => f.owner === 'player' && f.systemId === system.id);
      if (fleet.owner !== 'player' && !sensorPresent) continue;
      const index = orbitCounts.get(system.id) || 0; orbitCounts.set(system.id, index + 1);
      const element = document.createElement('button');
      element.type = 'button'; element.className = `galaxy-fleet${fleet.id === this.selectedFleetId ? ' is-selected' : ''}${fleet.owner !== 'player' ? ' is-foreign' : ''}${fleet.movesLeft <= 0 ? ' is-spent' : ''}`;
      element.dataset.fleetId = fleet.id;
      element.style.setProperty('--fleet-color', ownedColor(fleet.owner));
      const ship = SHIPS[fleet.type];
      element.textContent = `${ship?.icon || '△'}${fleet.ships > 1 ? ` ${fleet.ships}` : ''}`;
      element.title = `${fleet.name} · ${ship?.role || fleet.type} · ${fleet.movesLeft} jump${fleet.movesLeft === 1 ? '' : 's'} remaining`;
      element.setAttribute('aria-label', `${fleet.name}, ${ship?.role || fleet.type}, at ${system.name}`);
      element.setAttribute('aria-pressed', String(fleet.id === this.selectedFleetId));
      element.addEventListener('click', event => { event.stopPropagation(); this.onFleetSelect(fleet.id); });
      this.labelLayer.append(element);
      this.labels.push({ element, position: this.world(system), kind: 'fleet', systemId: system.id, offsetX: 25 + index * 28, offsetY: -16, priority: 90 });
    }
  }

  showTooltip(id, event) {
    if (!id || !this.state) { this.tooltip.hidden = true; return; }
    const system = this.systemsById.get(id);
    if (!system) return;
    const details = !visited(system) ? 'Unsurveyed · Send a fleet to explore' : `${PLANET_TYPES[system.type]?.name || 'World'} · ${system.habitability}% habitability${system.owner ? ` · ${FACTIONS[system.owner]?.shortName || system.owner}` : ''}`;
    this.tooltip.replaceChildren();
    const title = document.createElement('strong'); title.textContent = system.name;
    const line = document.createElement('span'); line.textContent = details;
    this.tooltip.append(title, line); this.tooltip.hidden = false;
    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${clamp(event.clientX - rect.left + 15, 8, this.width - Math.min(300, this.width - 16))}px`;
    this.tooltip.style.top = `${clamp(event.clientY - rect.top - 64, 8, this.height - 70)}px`;
  }

  pick(event) {
    if (this.fallback || !this.renderer) return null;
    const rect = this.container.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / this.width * 2 - 1, -(event.clientY - rect.top) / this.height * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    return hits[0]?.object.userData.systemId || null;
  }

  focus(systemId) {
    const system = this.systemsById?.get(systemId);
    if (!system || !known(system)) return;
    const pos = this.world(system); this.target.set(pos.x, pos.y);
    this.targetZoom = Math.max(this.targetZoom, 1.6);
    if (this.reducedMotion.matches) { this.camera.position.x = pos.x; this.camera.position.y = pos.y; this.camera.zoom = this.targetZoom; this.camera.updateProjectionMatrix(); }
    this.labelsDirty = true;
    this.requestFrame();
  }

  zoom(delta) {
    this.targetZoom = clamp(this.targetZoom * Math.exp(delta), .6, 4.5);
    if (this.reducedMotion.matches) { this.camera.zoom = this.targetZoom; this.camera.updateProjectionMatrix(); }
    this.labelsDirty = true;
    this.requestFrame();
  }

  reset() {
    this.target.copy(this.mapCenter); this.targetZoom = 1;
    if (this.reducedMotion.matches) { this.camera.position.x = this.target.x; this.camera.position.y = this.target.y; this.camera.zoom = 1; this.camera.updateProjectionMatrix(); }
    this.labelsDirty = true;
    this.requestFrame();
  }

  placeLabels() {
    this.camera.updateMatrixWorld();
    const occupied = [];
    const labels = this.sortedLabels || this.labels;
    for (const label of labels) {
      this.projected.copy(label.position).project(this.camera);
      const x = (this.projected.x * .5 + .5) * this.width + label.offsetX;
      const y = (-this.projected.y * .5 + .5) * this.height + label.offsetY;
      let visible = x > -50 && x < this.width + 50 && y > -20 && y < this.height + 35;
      if (visible && label.kind === 'system') {
        const box = { x: x - 53, y, w: 106, h: 32, systemId: label.systemId };
        if (label.priority < 80 && this.camera.zoom < 1.7) visible = !occupied.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
        if (visible) occupied.push(box);
      }
      label.element.style.visibility = visible ? 'visible' : 'hidden';
      label.element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)${label.kind === 'system' ? ' translateX(-50%)' : ''}`;
    }
    this.labelsDirty = false;
  }

  /** Pause decorative animation, while still drawing explicit updates once. */
  setPaused(paused) {
    const value = Boolean(paused);
    if (this.paused === value || this.disposed) return;
    this.paused = value;
    this.cancelScheduledFrame();
    this.requestFrame();
  }

  cancelScheduledFrame() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    if (this.frameTimer != null) clearTimeout(this.frameTimer);
    this.frame = null; this.frameTimer = null;
    this.lastTime = 0;
  }

  requestFrame() {
    this.needsRender = true;
    // User input and state updates should not wait for the next idle tick.
    if (this.frameTimer != null) { clearTimeout(this.frameTimer); this.frameTimer = null; }
    this.scheduleFrame();
  }

  scheduleFrame(delay = 0) {
    if (this.frame != null || this.frameTimer != null || this.disposed || document.hidden || !this.surfaceVisible || !this.viewportVisible) return;
    if (delay > 0) {
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null;
        this.scheduleFrame();
      }, delay);
    } else this.frame = requestAnimationFrame(this.animate);
  }

  animate(time) {
    this.frame = null;
    if (this.disposed || document.hidden || !this.surfaceVisible || !this.viewportVisible) return;
    const elapsed = Math.min(64, this.lastTime ? time - this.lastTime : 16); this.lastTime = time;
    const t = this.reducedMotion.matches || this.paused ? 1 : 1 - Math.exp(-elapsed / 95);
    const oldX = this.camera.position.x, oldY = this.camera.position.y, oldZoom = this.camera.zoom;
    const distance = Math.abs(oldX - this.target.x) + Math.abs(oldY - this.target.y) + Math.abs(oldZoom - this.targetZoom);
    const settle = distance <= .001;
    this.camera.position.x = settle ? this.target.x : THREE.MathUtils.lerp(oldX, this.target.x, t);
    this.camera.position.y = settle ? this.target.y : THREE.MathUtils.lerp(oldY, this.target.y, t);
    this.camera.zoom = settle ? this.targetZoom : THREE.MathUtils.lerp(oldZoom, this.targetZoom, t);
    const cameraChanged = oldX !== this.camera.position.x || oldY !== this.camera.position.y || oldZoom !== this.camera.zoom;
    if (oldZoom !== this.camera.zoom) this.camera.updateProjectionMatrix();
    if (cameraChanged) this.labelsDirty = true;
    const animateRings = !this.paused && !this.reducedMotion.matches && this.selectionRings.length > 0 && !this.contextLost;
    if (this.needsRender || cameraChanged || animateRings && time - this.lastRenderTime >= 1000 / 30) {
      if (animateRings) for (const ring of this.selectionRings) ring.rotation.z = time * .00009;
      if (this.labelsDirty) this.placeLabels();
      if (!this.contextLost) this.renderer?.render(this.scene, this.camera);
      this.lastRenderTime = time;
      this.needsRender = false;
    }
    const moving = this.camera.position.x !== this.target.x || this.camera.position.y !== this.target.y || this.camera.zoom !== this.targetZoom;
    if (!this.paused && moving) this.scheduleFrame();
    else if (animateRings) this.scheduleFrame(Math.max(1, 1000 / 30 - (performance.now() - this.lastRenderTime)));
  }

  clearGroup(group) {
    const geometries = new Set(), materials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledFrame();
    this.abort.abort(); this.resizeObserver.disconnect(); this.intersectionObserver.disconnect();
    this.clearGroup(this.dynamicGroup); this.clearGroup(this.staticGroup);
    for (const resource of this.resources) resource.dispose();
    this.renderer?.dispose();
    this.canvas.remove(); this.labelLayer.remove(); this.tooltip.remove(); this.backdropLabel.remove();
    this.fallbackNotice?.remove(); this.contextNotice?.remove();
    this.container.classList.remove('galaxy-view', 'galaxy-fallback', 'galaxy-dragging', 'galaxy-pointing');
  }
}
