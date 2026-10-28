import * as THREE from 'three';
import { FACTIONS, PLANET_TYPES, SHIPS } from './content.js';
import { getVisibleFleets } from './intelligence.js';
import { getPublicRaces } from './victory.js';
import { getRoutePreview, getRouteStatus } from './navigation.js';
import { getDiscoveryView } from './discoveries.js';
import { getKnownTransfers } from './public-affairs.js';
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
    this.routeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.routeLayer.classList.add('galaxy-route-overlay');
    this.routeLayer.setAttribute('aria-hidden', 'true');
    this.routeLayer.setAttribute('focusable', 'false');
    this.container.append(this.routeLayer);
    this.routes = [];
    this.routePoints = new Map();
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
    this.publicBeaconIds = new Set(getPublicRaces(state).flatMap(race => race.sites.map(site => site.id)));
    this.discoverySignals = new Set(state.systems.filter(system => ['opening', 'maturing', 'ready'].includes(getDiscoveryView(state, system.id)?.phase)).map(system => system.id));
    this.recentTransfers = new Map();
    for (const transfer of getKnownTransfers(state)) if (!this.recentTransfers.has(transfer.systemId)) this.recentTransfers.set(transfer.systemId, transfer);
    if (galaxyChanged) this.setBounds(state);
    this.clearGroup(this.dynamicGroup);
    this.labelLayer.replaceChildren();
    this.labels = []; this.hitTargets = []; this.selectionRings = [];
    const selectedFleet = state.fleets?.find(f => f.id === selectedFleetId);
    this.buildRoutes(state, selectedFleet);
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

  /** Route helpers are the sole source of path and uncertainty information. */
  buildRoutes(state, fleet) {
    this.routeLayer.replaceChildren();
    this.routes = [];
    this.routePoints = new Map();
    if (!fleet || fleet.owner !== 'player') return;
    const committed = getRouteStatus(state, fleet.id);
    const prospective = this.selectedSystemId && this.selectedSystemId !== fleet.systemId && this.selectedSystemId !== committed.destinationId
      ? getRoutePreview(state, fleet.id, this.selectedSystemId) : null;
    const svg = (tag, attributes, parent) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      parent.append(element);
      return element;
    };
    for (const [kind, result] of [['committed', committed], ['preview', prospective]]) {
      if (!result || !Array.isArray(result.path) || result.path.length < 2) continue;
      // A defensive boundary for malformed imported state, without discovering
      // anything the shared navigation forecast did not already supply.
      if (result.path.some(id => !known(this.systemsById.get(id) || {}))) continue;
      const group = svg('g', { class: `galaxy-route galaxy-route-${kind}` }, this.routeLayer);
      const segments = result.path.slice(1).map((id, index) => {
        const segment = svg('g', {}, group);
        const shadow = svg('path', { class: 'galaxy-route-shadow' }, segment);
        const line = svg('path', { class: 'galaxy-route-line' }, segment);
        return { from: result.path[index], to: id, shadow, line };
      });
      const destination = svg('circle', { class: 'galaxy-route-destination' }, group);
      this.routes.push({ kind, result, segments, destination });
      const uncertain = new Set(result.uncertainSystems || []);
      result.path.slice(1).forEach((id, index) => this.routePoints.set(id, {
        id, kind, number: index + 1, jumps: result.path.length - 1,
        destination: index === result.path.length - 2,
        uncertain: uncertain.has(id),
        stopReason: result.stopBefore?.systemId === id ? result.stopBefore.reason : '',
      }));
    }
    // Preview waypoints replace coincident course markers instead of stacking
    // two numbers over the same star. The two paths remain independently visible.
    for (const point of this.routePoints.values()) {
      const group = svg('g', { class: `galaxy-route-waypoint galaxy-route-${point.kind}${point.uncertain ? ' is-uncertain' : ''}${point.stopReason ? ' is-stopped' : ''}` }, this.routeLayer);
      svg('circle', { r: point.destination ? 9 : 8 }, group);
      const number = svg('text', { 'text-anchor': 'middle', dy: '.35em' }, group);
      number.textContent = point.number;
      point.element = group;
    }
  }

  placeRoutes() {
    if (!this.routes.length) return;
    this.routeLayer.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    const points = new Map();
    for (const route of this.routes) for (const id of route.result.path) {
      if (points.has(id)) continue;
      this.projected.copy(this.world(this.systemsById.get(id))).project(this.camera);
      points.set(id, {
        x: (this.projected.x * .5 + .5) * this.width,
        y: (-this.projected.y * .5 + .5) * this.height + (this.fallback ? 27 : 0),
      });
    }
    const radius = clamp(this.unit * 1.65 * this.height / this.baseHeight * this.camera.zoom, 6, 19);
    const committedEdges = new Set(this.routes.filter(route => route.kind === 'committed').flatMap(route => route.segments.map(segment => [segment.from, segment.to].sort().join(':'))));
    for (const route of this.routes) {
      const stoppedAt = route.result.stopBefore ? route.result.path.indexOf(route.result.stopBefore.systemId) : -1;
      route.segments.forEach((segment, index) => {
        const from = points.get(segment.from), to = points.get(segment.to);
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const dx = (to.x - from.x) / Math.max(1, length), dy = (to.y - from.y) / Math.max(1, length);
        const inset = Math.min(radius, length * .3);
        // A small parallel offset keeps a preview leg visible when it shares
        // the current course, without shifting either endpoint's waypoint.
        const shared = route.kind === 'preview' && committedEdges.has([segment.from, segment.to].sort().join(':'));
        const offset = shared ? 3.5 : 0;
        const d = `M ${from.x + dx * inset - dy * offset} ${from.y + dy * inset + dx * offset} L ${to.x - dx * inset - dy * offset} ${to.y - dy * inset + dx * offset}`;
        segment.line.setAttribute('d', d); segment.shadow.setAttribute('d', d);
        segment.line.classList.toggle('is-blocked', stoppedAt > 0 && index + 1 >= stoppedAt);
      });
      const end = points.get(route.result.path.at(-1));
      route.destination.setAttribute('cx', end.x); route.destination.setAttribute('cy', end.y);
      route.destination.setAttribute('r', radius + 5);
    }
    for (const point of this.routePoints.values()) {
      const position = points.get(point.id);
      point.element.setAttribute('transform', `translate(${position.x - radius - 4} ${position.y - radius - 4})`);
    }
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
    const owner = charted ? system.owner : null;
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
    if (this.discoverySignals.has(system.id)) {
      const points = [new THREE.Vector3(0, this.unit * .5, 0), new THREE.Vector3(this.unit * .35, 0, 0), new THREE.Vector3(0, -this.unit * .5, 0), new THREE.Vector3(-this.unit * .35, 0, 0), new THREE.Vector3(0, this.unit * .5, 0)];
      const marker = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#e9bb76' }));
      marker.position.set(position.x - this.unit * 2.5, position.y + this.unit * 2.5, 2);
      this.dynamicGroup.add(marker);
    }
    if (this.publicBeaconIds.has(system.id)) {
      const beacon = circle(this.unit * 4.3, '#e5c88c', .65, 6);
      beacon.position.copy(position); beacon.position.z = 1;
      this.dynamicGroup.add(beacon);
    }
  }

  buildLabel(system, position, surveyed, selected, reachable) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `galaxy-system-label${selected ? ' is-selected' : ''}${system.owner === 'player' ? ' is-owned' : ''}${!surveyed ? ' is-unsurveyed' : ''}${reachable ? ' is-reachable' : ''}`;
    element.dataset.systemId = system.id;
    element.style.setProperty('--system-color', system.owner ? ownedColor(system.owner) : '#bac8d9');
    element.setAttribute('aria-pressed', String(selected));
    const name = document.createElement('span'); name.className = 'galaxy-system-name'; name.textContent = system.name;
    element.append(name);
    const status = document.createElement('small'); status.className = 'galaxy-system-status';
    const beacon = this.publicBeaconIds.has(system.id);
    status.textContent = beacon ? `✦ ${FACTIONS[system.owner]?.shortName?.toUpperCase() || 'RESTORED'} BEACON` : system.owner ? FACTIONS[system.owner]?.shortName?.toUpperCase() || 'COLONY' : !surveyed ? 'UNSURVEYED' : this.discoverySignals.has(system.id) ? '◇ ANOMALY' : PLANET_TYPES[system.type]?.name?.toUpperCase() || 'SURVEYED';
    if (beacon) element.classList.add('is-beacon');
    const routePoint = this.routePoints.get(system.id);
    if (routePoint) element.classList.add(`is-route-${routePoint.kind}`);
    element.append(status);
    const transfer = this.recentTransfers.get(system.id);
    if (transfer) {
      const marker = document.createElement('small');
      marker.className = 'galaxy-transfer-marker';
      marker.textContent = `↳ TRANSFER · ${transfer.turn}`;
      element.title = `Cycle ${transfer.turn}: ${transfer.to.name} took control from ${transfer.from.name}.`;
      element.append(marker);
    }
    element.setAttribute('aria-label', `${system.name}, ${status.textContent.toLowerCase()}${reachable ? ', adjacent to selected fleet' : ''}${routePoint ? `, ${routePoint.kind === 'committed' ? 'plotted course' : 'route preview'} jump ${routePoint.number} of ${routePoint.jumps}${routePoint.destination ? ', destination' : ''}${routePoint.stopReason ? `, ${routePoint.stopReason}` : ''}` : ''}`);
    element.addEventListener('click', event => { event.stopPropagation(); this.onSelect(system.id); });
    element.addEventListener('dblclick', event => { event.stopPropagation(); this.focus(system.id); });
    this.labelLayer.append(element);
    this.labels.push({ element, position, kind: 'system', systemId: system.id, offsetX: 0, offsetY: 16, priority: selected ? 100 : beacon ? 85 : routePoint ? 84 : transfer ? 82 : system.owner === 'player' ? 80 : 40 });
  }

  buildFleetLabels(state) {
    const orbitCounts = new Map();
    for (const fleet of getVisibleFleets(state, 'player')) {
      const system = this.systemsById.get(fleet.systemId);
      if (!system || !known(system)) continue;
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
    const routePoint = this.routePoints.get(id);
    if (routePoint) {
      const route = document.createElement('span');
      route.className = 'galaxy-tooltip-route';
      route.textContent = `${routePoint.kind === 'committed' ? 'Plotted course' : 'Route preview'} · Jump ${routePoint.number} of ${routePoint.jumps}${routePoint.stopReason ? ` · ${routePoint.stopReason}` : routePoint.uncertain ? ' · Fleet presence unknown' : ''}`;
      this.tooltip.append(route);
    }
    const rect = this.container.getBoundingClientRect();
    this.tooltip.style.left = `${clamp(event.clientX - rect.left + 15, 8, this.width - Math.min(300, this.width - 16))}px`;
    this.tooltip.style.top = `${clamp(event.clientY - rect.top - 64, 8, Math.max(8, this.height - this.tooltip.offsetHeight - 8))}px`;
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
    this.targetZoom = clamp(this.targetZoom * Math.exp(delta), .35, 4.5);
    if (this.reducedMotion.matches) { this.camera.zoom = this.targetZoom; this.camera.updateProjectionMatrix(); }
    this.labelsDirty = true;
    this.requestFrame();
  }

  reset() {
    if (this.state?.systems?.length) return this.fitSystems(this.state.systems);
    this.target.copy(this.mapCenter); this.targetZoom = 1;
    if (this.reducedMotion.matches) { this.camera.position.x = this.target.x; this.camera.position.y = this.target.y; this.camera.zoom = this.targetZoom; this.camera.updateProjectionMatrix(); }
    this.labelsDirty = true;
    this.requestFrame();
  }

  /** Frame a supplied charted course without changing selection or issuing orders. */
  focusRoute(path) {
    if (!Array.isArray(path) || path.length < 2) return false;
    const systems = path.map(id => this.systemsById?.get(id));
    if (systems.some(system => !system || !known(system))) return false;
    return this.fitSystems(systems);
  }

  fitSystems(systems) {
    if (!systems.length || !this.surfaceVisible) return false;
    const rect = this.container.getBoundingClientRect();
    const page = this.container.closest('.galaxy-page');
    const heading = page?.querySelector('.map-heading')?.getBoundingClientRect();
    const fleetPanel = page?.querySelector('.fleet-bar')?.getBoundingClientRect();
    const graphicsNotice = (this.fallbackNotice || this.contextNotice)?.getBoundingClientRect();
    // Read chrome bounds only for an explicit fit. Selection, normal updates,
    // animation and a player's manual camera work never refit the map.
    const left = Math.min(72, this.width * .12), right = this.width - Math.min(120, this.width * .18);
    const top = Math.max(40, heading?.height ? heading.bottom - rect.top + 40 : 0, graphicsNotice?.height ? graphicsNotice.bottom - rect.top + 32 : 0);
    const panelTop = fleetPanel?.height && fleetPanel.top < rect.bottom ? fleetPanel.top - rect.top : this.height;
    const bottom = Math.max(top + 80, Math.min(this.height - 45, panelTop - 50));
    const positions = systems.map(system => this.world(system));
    const minX = Math.min(...positions.map(position => position.x)), maxX = Math.max(...positions.map(position => position.x));
    const minY = Math.min(...positions.map(position => position.y)), maxY = Math.max(...positions.map(position => position.y));
    const scale = Math.min((right - left) / Math.max(this.unit * 10, maxX - minX), (bottom - top) / Math.max(this.unit * 10, maxY - minY));
    this.targetZoom = clamp(scale * this.baseHeight / this.height, .35, 4.5);
    const fittedScale = this.height * this.targetZoom / this.baseHeight;
    this.target.set((minX + maxX) / 2 - ((left + right) / 2 - this.width / 2) / fittedScale,
      (minY + maxY) / 2 + ((top + bottom) / 2 - this.height / 2 - (this.fallback ? 27 : 0)) / fittedScale);
    if (this.reducedMotion.matches) {
      this.camera.position.x = this.target.x; this.camera.position.y = this.target.y;
      this.camera.zoom = this.targetZoom; this.camera.updateProjectionMatrix();
    }
    this.labelsDirty = true;
    this.requestFrame();
    return true;
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
    this.placeRoutes();
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
    this.canvas.remove(); this.routeLayer.remove(); this.labelLayer.remove(); this.tooltip.remove(); this.backdropLabel.remove();
    this.fallbackNotice?.remove(); this.contextNotice?.remove();
    this.container.classList.remove('galaxy-view', 'galaxy-fallback', 'galaxy-dragging', 'galaxy-pointing');
  }
}
