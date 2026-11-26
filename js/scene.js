// The 3D map. Holons all the way down: every project is a cube with a smaller
// cube inside it, every cluster is a shell holding cubes, and the HQ heart
// sits in the middle of the governance shell with branches to every room.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { connectionsOf, statusLabel } from './main.js';

const STATUS_COLOR = {
  'active': 0x39ff88,
  'awaiting-deployment': 0xffc857,
  'done': 0x5ce1ff,
  'for-sale': 0xff5c8a,
};
const NEON = 0x39ff88;
const LOVE = 0xff3b3b;
const FLOOR_Y = -15;
const HOME = { pos: new THREE.Vector3(0, 16, 74), target: new THREE.Vector3(0, 5, -6) };

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(25, 25);
  s.bezierCurveTo(25, 25, 20, 0, 0, 0);
  s.bezierCurveTo(-30, 0, -30, 35, -30, 35);
  s.bezierCurveTo(-30, 55, -10, 77, 25, 95);
  s.bezierCurveTo(60, 77, 80, 55, 80, 35);
  s.bezierCurveTo(80, 35, 80, 0, 50, 0);
  s.bezierCurveTo(35, 0, 25, 25, 25, 25);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 18, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 4, curveSegments: 24 });
  geo.center();
  geo.rotateZ(Math.PI);
  geo.scale(0.036, 0.036, 0.036);
  return geo;
}

export function startScene(model) {
  document.getElementById('stage').hidden = false;
  const host = document.getElementById('gl');
  const labelsEl = document.getElementById('labels');

  /* ---------- renderer, camera, controls ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x020805, 1);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020805, 0.0052);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1200);
  camera.position.set(0, 60, 190);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 170;
  controls.maxPolarAngle = Math.PI * 0.86;
  controls.autoRotateSpeed = 0.35;
  controls.target.copy(HOME.target);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const glow = glowTexture();

  /* ---------- layout: positions from clusters ---------- */
  const clusterById = new Map(model.clusters.map((c) => [c.id, c]));
  for (const c of model.clusters) {
    const center = new THREE.Vector3(...c.center);
    const tilt = new THREE.Euler(...(c.tilt || [0, 0, 0]));
    const members = model.nodes.filter((n) => n.cluster === c.id).sort((a, b) => a.rank - b.rank);
    // The highest-priority member (or the HQ) is the nucleus; the rest orbit it.
    const [nucleus, ...ring] = members;
    if (nucleus) nucleus.pos = center.clone();
    ring.forEach((n, i) => {
      const a = Math.PI / 2 + (i / ring.length) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * c.radius, Math.sin(a * 2) * c.radius * 0.18, Math.sin(a) * c.radius);
      v.applyEuler(tilt);
      n.pos = center.clone().add(v);
    });
    c.vCenter = center;
  }

  /* ---------- environment: stars, floor, ripples ---------- */
  {
    const N = 2200, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 160 + Math.random() * 380;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7 + 30, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7dffb0, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.45, fog: false })));

    // A softer layer of dust close to the structure.
    const M = 700, dpos = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) dpos.set([(Math.random() - 0.5) * 140, Math.random() * 70 - 15, (Math.random() - 0.5) * 120 - 10], i * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    scene.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: NEON, size: 0.14, transparent: true, opacity: 0.35 })));
  }
  const floor = new THREE.PolarGridHelper(58, 24, 12, 96, 0x1a6b3d, 0x0f3d24);
  floor.position.y = FLOOR_Y;
  floor.material.transparent = true;
  floor.material.opacity = 0.28;
  scene.add(floor);
  const grid = new THREE.GridHelper(400, 80, 0x0b2a18, 0x0b2a18);
  grid.position.y = FLOOR_Y - 0.05;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  const ripples = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 128),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = FLOOR_Y + 0.05;
    m.userData.phase = i / 4;
    scene.add(m);
    ripples.push(m);
  }
  // Pillar of light from the floor up into the heart.
  {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.6, Math.abs(FLOOR_Y) - 2, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.y = FLOOR_Y / 2 - 1;
    scene.add(beam);
  }

  /* ---------- cluster shells (holons of holons) ---------- */
  const shells = [];
  for (const c of model.clusters) {
    if (c.id === model.hq.cluster) continue;
    const r = c.radius + 4.5;
    const geo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r, 1));
    const shell = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell.position.copy(c.vCenter);
    shell.userData.spin = (Math.random() - 0.5) * 0.05;
    scene.add(shell);
    shells.push(shell);
  }

  /* ---------- project nodes ---------- */
  const pickables = [];
  for (const n of model.nodes) {
    const color = new THREE.Color(n.isHQ ? NEON : n.isGhost ? 0xcfe9da : STATUS_COLOR[n.status] || NEON);
    const size = n.isHQ ? 4.6 : n.isGhost ? 1.8 : Math.max(1.7, 2.8 - n.rank * 0.05);
    n.size = size;
    const g = new THREE.Group();
    g.position.copy(n.pos);

    const box = new THREE.BoxGeometry(size, size, size);
    const face = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: n.isHQ ? 0.02 : 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
    face.userData.node = n;
    pickables.push(face);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), n.isGhost
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.45 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    if (n.isGhost) edges.computeLineDistances();
    const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 0.38, size * 0.38, size * 0.38)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    inner.rotation.set(0.6, 0.8, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(size * (n.isHQ ? 1.4 : 2.1));
    g.add(face, edges, inner, halo);

    const mats = [
      { m: face.material, base: n.isGhost ? 0.015 : 0.06 }, { m: edges.material, base: n.isGhost ? 0.45 : 0.9 },
      { m: inner.material, base: 0.55 }, { m: halo.material, base: n.isHQ ? 0.06 : n.isGhost ? 0.05 : 0.2 },
    ];

    if (n.isHQ) {
      // Human first and AI first at once: a red heart inside the machine cube.
      const heart = new THREE.Mesh(heartGeometry(), new THREE.MeshBasicMaterial({ color: LOVE }));
      const heartGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: LOVE, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      heartGlow.scale.setScalar(6);
      const twin = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size)), new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.45 }));
      twin.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      const meta = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(size * 1.05, 0)), new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.3 }));
      g.add(heart, heartGlow, twin, meta);
      inner.visible = false;
      n.heart = heart; n.heartGlow = heartGlow; n.twin = twin; n.meta = meta;
      mats.push({ m: twin.material, base: 0.45 }, { m: meta.material, base: 0.3 });
    }

    if (n.isGhost) inner.visible = false;
    n.obj = g; n.inner = inner; n.mats = mats; n.vis = 1; n.visTarget = 1; n.scaleTarget = 1;
    n.spin = (Math.random() - 0.5) * 0.25;
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
  }

  /* ---------- edges: stated, inferred, and branches to the heart ---------- */
  const edges = [];
  const incident = new Map(model.nodes.map((n) => [n, []]));
  const makeEdge = (a, b, kind, why) => {
    const A = a.pos, B = b.pos;
    const d = A.distanceTo(B);
    let ctrl;
    if (kind === 'branch') {
      // Branches leave the heart going up, then bend out: a tree, like the reference.
      ctrl = new THREE.Vector3(B.x * 0.18, Math.max(A.y, B.y) * 0.75 - 2, B.z * 0.18);
    } else {
      ctrl = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, d * 0.22, 0));
    }
    const curve = new THREE.QuadraticBezierCurve3(A.clone(), ctrl, B.clone());
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
    if (kind === 'member') ctrl = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, d * 0.08, 0));
    const base = { stated: 0.7, inferred: 0.4, branch: 0.16, member: 0.2 }[kind];
    const mat = kind === 'inferred'
      ? new THREE.LineDashedMaterial({ color: NEON, dashSize: 0.7, gapSize: 0.55, transparent: true, opacity: base })
      : new THREE.LineBasicMaterial({ color: kind === 'stated' ? NEON : 0x2bd36f, transparent: true, opacity: base });
    const line = new THREE.Line(geo, mat);
    if (kind === 'inferred') line.computeLineDistances();
    scene.add(line);
    const e = { a, b, kind, why, curve, line, base, vis: base };
    edges.push(e);
    incident.get(a).push(e);
    incident.get(b).push(e);
    return e;
  };
  for (const l of model.links) makeEdge(l.a, l.b, l.kind, l.why);
  // Hierarchy: HQ -> each cluster's nucleus -> the cluster's other rooms.
  const linked = (a, b) => edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  for (const c of model.clusters) {
    if (c.id === model.hq.cluster) continue;
    const [nucleus, ...rest] = model.nodes.filter((n) => n.cluster === c.id).sort((a, b) => a.rank - b.rank);
    if (!nucleus) continue;
    c.nucleus = nucleus;
    if (!linked(model.hq, nucleus)) makeEdge(model.hq, nucleus, 'branch');
    for (const m of rest) if (!linked(nucleus, m)) makeEdge(nucleus, m, 'member');
  }

  /* ---------- agents: little lights wandering the network ---------- */
  const agents = [];
  const agentMat = new THREE.SpriteMaterial({ map: glow, color: 0xeafff2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const spawnAgent = (edge, dir) => {
    const s = new THREE.Sprite(agentMat);
    s.scale.setScalar(0.9);
    scene.add(s);
    agents.push({ s, edge, dir, t: Math.random(), speed: 0.08 + Math.random() * 0.1 });
  };
  for (const e of edges) {
    const count = e.kind === 'stated' ? 2 : e.kind === 'inferred' || e.kind === 'branch' ? 1 : Math.random() < 0.5 ? 1 : 0;
    for (let i = 0; i < count; i++) spawnAgent(e, Math.random() < 0.5 ? 1 : -1);
  }

  /* ---------- HTML labels ---------- */
  const labelFor = new Map();
  for (const n of model.nodes) {
    const el = document.createElement('div');
    el.className = 'label' + (n.isHQ ? ' hq' : '');
    el.innerHTML = `<span class="num"></span><span class="name"></span><span class="tag"></span>`;
    el.querySelector('.num').textContent = n.isHQ ? 'HQ' : n.num;
    el.querySelector('.name').textContent = n.isGhost ? 'empty room' : n.name.replace(/\s*\(.*\)/, '');
    el.querySelector('.tag').textContent = n.tagline;
    el.addEventListener('pointerenter', () => setHover(n));
    el.addEventListener('pointerleave', () => setHover(null));
    el.addEventListener('click', () => select(n));
    labelsEl.append(el);
    labelFor.set(n, el);
  }
  const clusterLabels = model.clusters.filter((c) => c.id !== model.hq.cluster).map((c) => {
    const el = document.createElement('div');
    el.className = 'label cluster';
    const count = model.nodes.filter((n) => n.cluster === c.id && !n.isGhost).length;
    el.innerHTML = `<span class="name"></span><span class="count"></span>`;
    el.querySelector('.name').textContent = c.label;
    el.querySelector('.count').textContent = count ? `${count} room${count > 1 ? 's' : ''}` : 'coming';
    el.title = c.blurb || '';
    el.addEventListener('click', () => flyToCluster(c));
    labelsEl.append(el);
    return { el, c, pos: c.vCenter.clone().add(new THREE.Vector3(0, c.radius + 5.5, 0)) };
  });

  /* ---------- left index + filters ---------- */
  const indexEl = document.getElementById('index');
  const indexBtn = new Map();
  const groups = model.clusters.map((c) => ({ id: c.id, label: c.label, nodes: model.nodes.filter((n) => n.cluster === c.id) }));
  const groupEls = new Map();
  for (const gr of groups) {
    const c = clusterById.get(gr.id);
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'grp';
    const real = gr.nodes.filter((n) => !n.isGhost).length;
    h.innerHTML = `<span></span><span class="cnt"></span>`;
    h.children[0].textContent = gr.label;
    h.children[1].textContent = gr.id === model.hq.cluster ? '' : real ? String(real) : '·';
    const rooms = document.createElement('div');
    rooms.className = 'rooms';
    rooms.hidden = true;
    h.addEventListener('click', () => {
      if (gr.id === model.hq.cluster) { select(model.hq); return; }
      const open = rooms.hidden;
      for (const g of groupEls.values()) { g.rooms.hidden = true; g.h.classList.remove('open'); }
      rooms.hidden = !open;
      h.classList.toggle('open', open);
      if (open) flyToCluster(c);
    });
    indexEl.append(h, rooms);
    groupEls.set(gr.id, { h, rooms });
    for (const n of gr.nodes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="n"></span><span></span>`;
      b.children[0].textContent = n.isHQ ? '◆' : n.num;
      b.children[1].textContent = n.isGhost ? 'empty room' : n.name.replace(/\s*\(.*\)/, '');
      b.addEventListener('click', () => select(n));
      b.addEventListener('pointerenter', () => setHover(n));
      b.addEventListener('pointerleave', () => setHover(null));
      rooms.append(b);
      indexBtn.set(n, b);
    }
  }

  let activeTag = null;
  const filtersEl = document.getElementById('filters');
  const tagCount = new Map();
  for (const n of model.nodes) for (const t of n.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const tags = [...tagCount.keys()].sort((a, b) => tagCount.get(b) - tagCount.get(a) || a.localeCompare(b));
  for (const t of [null, ...tags]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t ? `#${t}` : 'all';
    b.setAttribute('aria-pressed', String(t === activeTag));
    b.addEventListener('click', () => {
      activeTag = t;
      filtersEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refreshFocus();
    });
    filtersEl.append(b);
  }

  /* ---------- status box ---------- */
  {
    const total = model.nodes.filter((n) => !n.isGhost).length;
    const live = model.nodes.filter((n) => n.status === 'active').length;
    setTimeout(() => {
      document.getElementById('status-text').textContent = `${live}/${total} ROOMS LIVE · ${agents.length} AGENTS`;
      document.getElementById('status-bar').style.width = `${Math.round((live / total) * 100)}%`;
    }, 900);
  }

  /* ---------- focus / highlight state ---------- */
  let hovered = null, selected = null;
  const matchesFilter = (n) => !activeTag || n.tags.includes(activeTag);

  function refreshFocus() {
    const focus = hovered || selected;
    const lit = new Set();
    if (focus) {
      lit.add(focus);
      for (const e of incident.get(focus)) { lit.add(e.a); lit.add(e.b); }
    }
    for (const n of model.nodes) {
      let v = 1;
      if (focus) v = lit.has(n) ? 1 : 0.14;
      else if (activeTag) v = matchesFilter(n) ? 1 : 0.12;
      n.visTarget = v;
      n.lit = focus ? lit.has(n) : activeTag ? matchesFilter(n) : false;
      n.scaleTarget = n === focus ? 1.18 : 1;
      const el = labelFor.get(n);
      el.classList.toggle('hot', n === focus);
      indexBtn.get(n).classList.toggle('dim', !focus && activeTag && !matchesFilter(n));
    }
    for (const e of edges) {
      let v = e.base;
      if (focus) {
        const on = e.a === focus || e.b === focus;
        v = on ? (e.kind === 'branch' ? 0.5 : 1) : e.base * 0.15;
      } else if (activeTag) {
        v = matchesFilter(e.a) && matchesFilter(e.b) ? e.base : e.base * 0.12;
      }
      e.visTarget = v;
    }
  }

  function setHover(n) {
    if (hovered === n) return;
    hovered = n;
    renderer.domElement.parentElement.classList.toggle('pointing', !!n);
    refreshFocus();
  }

  /* ---------- camera flights ---------- */
  let flight = null;
  function flyTo(pos, target, dur = 1.4) {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), dur: reducedMotion ? 0.01 : dur };
  }
  function flyToNode(n) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    // Keep a pleasant angle: not from directly below, not too flat.
    dir.y = THREE.MathUtils.clamp(dir.y, 0.12, 0.6);
    dir.normalize();
    const dist = n.isHQ ? 28 : 16 + n.size * 2.6;
    // Shift the focus point slightly right so the panel on the right doesn't cover the cube.
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const target = n.pos.clone().add(right.multiplyScalar(dist * 0.18));
    flyTo(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  function flyToCluster(c) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    dir.y = THREE.MathUtils.clamp(dir.y, 0.15, 0.5);
    dir.normalize();
    const dist = c.radius * 2.2 + 20;
    flyTo(c.vCenter.clone().add(dir.multiplyScalar(dist)), c.vCenter, 1.4);
    lastInteraction = performance.now();
  }

  /* ---------- panel ---------- */
  const panel = document.getElementById('panel');
  const clusterLabel = Object.fromEntries(model.clusters.map((c) => [c.id, c.label]));
  function fillPanel(n) {
    panel.hidden = false;
    // restart entrance animation
    panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
    panel.querySelector('.panel-num').textContent = n.isHQ ? 'HQ · CENTRE OF EVERYTHING' : n.isGhost ? 'EMERGING · NOT BUILT YET' : `${n.num} · ${clusterLabel[n.cluster].toUpperCase()}`;
    panel.querySelector('.panel-name').textContent = n.name;
    const st = panel.querySelector('.panel-status');
    st.className = `panel-status st-${n.status}`;
    st.textContent = statusLabel(n.status);
    panel.querySelector('.panel-tagline').textContent = n.tagline;
    panel.querySelector('.panel-about').textContent = n.about;
    const tagsEl = panel.querySelector('.panel-tags');
    tagsEl.replaceChildren(...n.tags.map((t) => Object.assign(document.createElement('span'), { textContent: `#${t}` })));
    const linksEl = panel.querySelector('.panel-links');
    linksEl.replaceChildren();
    const conns = connectionsOf(model, n);
    if (conns.length) {
      const h = Object.assign(document.createElement('h4'), { textContent: 'CONNECTED ROOMS' });
      const ul = document.createElement('ul');
      for (const c of conns) {
        const li = document.createElement('li');
        const b = Object.assign(document.createElement('button'), { type: 'button', textContent: `→ ${c.other.name.replace(/\s*\(.*\)/, '')}` });
        b.addEventListener('click', () => select(c.other));
        li.append(b);
        if (c.kind === 'inferred') {
          li.append(Object.assign(document.createElement('span'), { className: 'kind', textContent: 'inferred' }));
          if (c.why) li.append(Object.assign(document.createElement('span'), { className: 'why', textContent: c.why }));
        }
        ul.append(li);
      }
      linksEl.append(h, ul);
    }
    const visit = panel.querySelector('.panel-visit');
    visit.hidden = !n.href;
    if (n.href) visit.href = n.href;
    visit.textContent = n.isHQ ? 'Enter HQ ↗' : 'Enter project ↗';
  }

  function select(n, { fly = true } = {}) {
    selected = n;
    fillPanel(n);
    if (fly) flyToNode(n);
    for (const [m, b] of indexBtn) b.classList.toggle('on', m === n);
    for (const [id, g] of groupEls) { const on = id === n.cluster && id !== model.hq.cluster; g.rooms.hidden = !on; g.h.classList.toggle('open', on); }
    document.getElementById('here').textContent = n.isHQ ? 'HQ' : `${clusterLabel[n.cluster]} / ${n.isGhost ? 'empty room' : n.name.replace(/\s*\(.*\)/, '')}`;
    history.replaceState(null, '', `#${n.id}`);
    refreshFocus();
  }
  function deselect({ home = false } = {}) {
    selected = null;
    panel.hidden = true;
    for (const b of indexBtn.values()) b.classList.remove('on');
    document.getElementById('here').textContent = 'THE MULTIVERSE';
    history.replaceState(null, '', location.pathname + location.search);
    if (home) flyTo(HOME.pos, HOME.target, 1.6);
    refreshFocus();
  }
  const step = (d) => {
    const i = selected ? selected.rank : -1;
    const N = model.nodes.length;
    select(model.nodes[(i + d + N) % N]);
  };

  panel.querySelector('.panel-close').addEventListener('click', () => deselect({ home: true }));
  panel.querySelectorAll('.panel-nav button').forEach((b) => b.addEventListener('click', () => step(Number(b.dataset.step))));
  document.getElementById('btn-reset').addEventListener('click', () => deselect({ home: true }));
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') deselect({ home: true });
  });

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  let lastInteraction = performance.now();
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.node : null;
  };
  renderer.domElement.addEventListener('pointermove', (ev) => { if (!down) setHover(pick(ev)); });
  renderer.domElement.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; lastInteraction = performance.now(); flight = null; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const wasClick = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
    down = null;
    lastInteraction = performance.now();
    if (!wasClick) return;
    const n = pick(ev);
    if (n) select(n); else if (selected) deselect();
  });
  renderer.domElement.addEventListener('pointerleave', () => setHover(null));
  renderer.domElement.addEventListener('wheel', () => { lastInteraction = performance.now(); flight = null; }, { passive: true });

  /* ---------- resize ---------- */
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  /* ---------- loop ---------- */
  const tmp = new THREE.Vector3();
  const clock = new THREE.Clock();
  let W = innerWidth, H = innerHeight;
  addEventListener('resize', () => { W = innerWidth; H = innerHeight; });

  function placeLabel(el, worldPos, yOffsetPx = 0) {
    tmp.copy(worldPos).project(camera);
    if (tmp.z > 1 || tmp.z < -1) { el.style.visibility = 'hidden'; return null; }
    el.style.visibility = '';
    const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H + yOffsetPx;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    return tmp.z;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const motion = reducedMotion ? 0.15 : 1;

    // Camera flight.
    if (flight) {
      const k = Math.min(1, (performance.now() - flight.start) / (flight.dur * 1000));
      const e = ease(k);
      camera.position.lerpVectors(flight.p0, flight.p1, e);
      controls.target.lerpVectors(flight.t0, flight.t1, e);
      if (k >= 1) flight = null;
    }
    controls.autoRotate = !reducedMotion && !selected && !hovered && !flight && performance.now() - lastInteraction > 7000;
    controls.update();

    // Nodes.
    for (const n of model.nodes) {
      n.vis += (n.visTarget - n.vis) * Math.min(1, dt * 6);
      for (const { m, base } of n.mats) m.opacity = base * n.vis;
      const s = n.obj.scale.x + (n.scaleTarget - n.obj.scale.x) * Math.min(1, dt * 8);
      n.obj.scale.setScalar(s);
      n.obj.rotation.y += n.spin * dt * motion;
      n.obj.position.y = n.pos.y + Math.sin(t * 0.6 + n.rank) * 0.25 * motion;
      n.inner.rotation.x += dt * 0.5 * motion;
      n.inner.rotation.y -= dt * 0.7 * motion;
      if (n.isHQ) {
        const beat = 1 + Math.pow(Math.max(0, Math.sin(t * 2.4)), 12) * 0.22;
        n.heart.scale.setScalar(beat);
        n.heartGlow.scale.setScalar(6 * beat);
        n.heart.rotation.y = Math.sin(t * 0.5) * 0.6 - n.obj.rotation.y;
        n.twin.rotation.x += dt * 0.2 * motion;
        n.meta.rotation.y -= dt * 0.12 * motion;
      }
    }

    // Edges.
    for (const e of edges) {
      e.vis += ((e.visTarget ?? e.base) - e.vis) * Math.min(1, dt * 6);
      e.line.material.opacity = e.vis;
    }

    // Agents wander: on arrival they pick another edge touching the node they reached.
    for (const a of agents) {
      a.t += a.dir * a.speed * dt * motion * (a.edge.kind === 'branch' ? 0.7 : 1);
      if (a.t > 1 || a.t < 0) {
        const at = a.t > 1 ? a.edge.b : a.edge.a;
        const options = incident.get(at);
        const next = options[(Math.random() * options.length) | 0];
        a.edge = next;
        a.dir = next.a === at ? 1 : -1;
        a.t = a.dir === 1 ? 0 : 1;
      }
      a.edge.curve.getPoint(a.t, a.s.position);
      const fade = Math.max(a.edge.vis / a.edge.base, 0.2);
      a.s.scale.setScalar(0.85 * Math.min(1, fade));
    }

    // Shells and ripples.
    for (const s of shells) { s.rotation.y += s.userData.spin * dt * motion; s.rotation.x += s.userData.spin * 0.4 * dt * motion; }
    for (const r of ripples) {
      const p = (t * 0.12 * motion + r.userData.phase) % 1;
      r.scale.setScalar(4 + p * 54);
      r.material.opacity = (1 - p) * (1 - p) * 0.22;
    }

    // Labels: position, and fade with distance so far rooms recede.
    for (const n of model.nodes) {
      const el = labelFor.get(n);
      const wp = n.obj.position.clone().add(new THREE.Vector3(0, n.size * 0.62 * n.obj.scale.x + 0.35, 0));
      if (placeLabel(el, wp, -4) === null) continue;
      const dist = camera.position.distanceTo(n.obj.position);
      // Quiet by default: names appear for the HQ, for whatever is in focus,
      // and for rooms the camera has flown close to.
      const focus = hovered || selected;
      const show = n.isHQ || n === focus || n.lit || (!focus && !activeTag && dist < 34);
      el.classList.toggle('show', show);
      el.style.zIndex = String(1000 - Math.round(dist));
    }
    for (const cl of clusterLabels) {
      if (placeLabel(cl.el, cl.pos) === null) continue;
      const d = camera.position.distanceTo(cl.c.vCenter);
      // Cluster names give way to room names once you're inside the cluster.
      cl.el.classList.toggle('show', d > cl.c.radius * 2 + 16);
    }

    composer.render();
  }

  // Intro flight, then honour a #hash deep link.
  flyTo(HOME.pos, HOME.target, reducedMotion ? 0.01 : 2.8);
  requestAnimationFrame(frame);
  const fromHash = model.nodes.find((n) => `#${n.id}` === location.hash);
  if (fromHash) setTimeout(() => select(fromHash), reducedMotion ? 0 : 2400);
  refreshFocus();
}
