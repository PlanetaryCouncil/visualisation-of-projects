// The 3D map. Layout is derived only from the source data:
//   - stated connections (connects_to) are strong springs and visible lines,
//   - shared tags are weak invisible springs, so related projects drift together,
//   - everything repels a little, and the core (Planetary Council) sits at the centre.
// Tag groups are drawn as faint overlapping shells: holons that share members.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { neighbours, shortName, statusLabel } from './main.js';

const STATUS_COLOR = { 'active': 0x39ff88, 'awaiting-deployment': 0xffc857, 'done': 0x5ce1ff, 'for-sale': 0xff5c8a };
const NEON = 0x39ff88;
const LOVE = 0xff3b3b;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- layout ---------- */
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function layout(model) {
  const N = model.nodes;
  const rnd = seeded(N.map((n) => n.name).join('|'));
  for (const n of N) {
    n.p = n.isCore ? new THREE.Vector3() : new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30);
    n.v = new THREE.Vector3();
  }
  const springs = [];
  for (const l of model.links) springs.push({ a: l.a, b: l.b, rest: l.kind === 'stated' ? 8 : 13, k: l.kind === 'stated' ? 0.06 : 0.025 });
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const shared = N[i].tags.filter((t) => N[j].tags.includes(t)).length;
    if (shared) springs.push({ a: N[i], b: N[j], rest: 10, k: 0.012 * shared });
  }
  const d = new THREE.Vector3();
  for (let it = 0; it < 600; it++) {
    const cool = 1 - it / 600;
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      d.subVectors(N[i].p, N[j].p);
      const dist2 = Math.max(d.lengthSq(), 0.5);
      d.multiplyScalar(90 / dist2 / Math.sqrt(dist2));
      N[i].v.add(d); N[j].v.sub(d);
    }
    for (const s of springs) {
      d.subVectors(s.b.p, s.a.p);
      const len = d.length() || 0.01;
      d.multiplyScalar(((len - s.rest) * s.k) / len);
      s.a.v.add(d); s.b.v.sub(d);
    }
    for (const n of N) {
      n.v.addScaledVector(n.p, -0.009);       // gravity to the centre keeps it one body
      n.v.y -= n.p.y * 0.006;                 // a little flatter than a ball
      if (n.isCore) { n.p.set(0, 0, 0); n.v.set(0, 0, 0); continue; }
      n.v.multiplyScalar(0.82);
      n.p.addScaledVector(n.v, 0.6 + cool);
    }
  }
  for (const n of N) { n.pos = n.p; delete n.p; delete n.v; }
}

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
  geo.scale(0.034, 0.034, 0.034);
  return geo;
}

export function startScene(model) {
  document.getElementById('stage').hidden = false;
  const host = document.getElementById('gl');
  const labelsEl = document.getElementById('labels');
  layout(model);

  // Frame the whole network.
  const radii = model.nodes.map((n) => n.pos.length()).sort((a, b) => a - b);
  const R = radii[Math.floor(radii.length * 0.85)] + 4;
  const minY = Math.min(...model.nodes.map((n) => n.pos.y));
  const FLOOR_Y = minY - 7;
  const HOME = { pos: new THREE.Vector3(0, R * 0.5, R * 1.75), target: new THREE.Vector3(0, 0, 0) };

  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020805);
  scene.fog = new THREE.FogExp2(0x020805, 0.005);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1500);
  camera.position.copy(HOME.pos).multiplyScalar(2.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = R * 5;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.autoRotateSpeed = 0.3;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 0.32));
  composer.addPass(new OutputPass());
  const glow = glowTexture();

  /* ---------- environment ---------- */
  {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 180 + Math.random() * 380, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7 + 30, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7dffb0, size: 0.9, transparent: true, opacity: 0.45, fog: false })));
  }
  const floor = new THREE.PolarGridHelper(R * 1.6, 24, 12, 96, 0x1a6b3d, 0x0f3d24);
  floor.position.y = FLOOR_Y;
  floor.material.transparent = true;
  floor.material.opacity = 0.18;
  scene.add(floor);
  const ripples = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 128),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = FLOOR_Y + 0.05;
    m.userData.phase = i / 4;
    scene.add(m);
    ripples.push(m);
  }
  {
    const h = Math.abs(FLOOR_Y) - 2.5;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.6, h, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = FLOOR_Y + h / 2;
    scene.add(beam);
  }

  /* ---------- tag shells: overlapping holons ---------- */
  const groups = [];
  const tagMembers = new Map();
  for (const n of model.nodes) for (const t of n.tags) tagMembers.set(t, [...(tagMembers.get(t) || []), n]);
  // Tags that cover nearly the same projects (e.g. ai and art) become one shell.
  const sets = [...tagMembers].filter(([, m]) => m.length >= 3).map(([tag, m]) => ({ tags: [tag], m: new Set(m) }));
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const A = sets[i].m, B = sets[j].m;
    const inter = [...A].filter((x) => B.has(x)).length;
    if (inter / new Set([...A, ...B]).size >= 0.6) {
      sets[i].tags.push(...sets[j].tags);
      B.forEach((x) => A.add(x));
      sets.splice(j--, 1);
    }
  }
  for (const { tags, m } of sets) {
    const tag = tags.join(' · ');
    const members = [...m];
    const c = members.reduce((acc, n) => acc.add(n.pos), new THREE.Vector3()).divideScalar(members.length);
    const r = Math.max(...members.map((n) => n.pos.distanceTo(c))) + 3;
    const shell = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r, 1)),
      new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell.position.copy(c);
    shell.userData.spin = (Math.random() - 0.5) * 0.04;
    scene.add(shell);
    const el = document.createElement('div');
    el.className = 'label group show';
    el.textContent = tag;
    labelsEl.append(el);
    groups.push({ tag, members, shell, el, top: c.clone().add(new THREE.Vector3(0, r, 0)), base: 0.05, vis: 0.05 });
  }

  /* ---------- nodes ---------- */
  const pickables = [];
  for (const n of model.nodes) {
    const color = new THREE.Color(n.isCore ? NEON : STATUS_COLOR[n.status] || NEON);
    const size = n.isCore ? 4.4 : Math.max(1.6, 2.7 - n.rank * 0.05);
    n.size = size;
    const g = new THREE.Group();
    g.position.copy(n.pos);
    const box = new THREE.BoxGeometry(size, size, size);
    const face = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    face.userData.node = n;
    pickables.push(face);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 0.38, size * 0.38, size * 0.38)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    inner.rotation.set(0.6, 0.8, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(size * 2.1);
    g.add(face, edges, inner, halo);
    const mats = [{ m: face.material, base: 0.05 }, { m: edges.material, base: 0.9 }, { m: inner.material, base: 0.55 }, { m: halo.material, base: 0.2 }];

    if (n.isCore) {
      // Human and AI at once: a red heart inside the machine cube.
      inner.visible = false;
      halo.material.opacity = 0.05; mats[3].base = 0.05;
      const heart = new THREE.Mesh(heartGeometry(), new THREE.MeshBasicMaterial({ color: LOVE }));
      const heartGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: LOVE, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      heartGlow.scale.setScalar(6);
      const twin = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.45 }));
      twin.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      const meta = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(size * 1.05, 0)), new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.3 }));
      g.add(heart, heartGlow, twin, meta);
      Object.assign(n, { heart, heartGlow, twin, meta });
      mats.push({ m: twin.material, base: 0.45 }, { m: meta.material, base: 0.3 });
    }
    Object.assign(n, { obj: g, inner, mats, vis: 1, visTarget: 1, scaleTarget: 1, spin: (Math.random() - 0.5) * 0.25 });
    g.rotation.y = Math.random() * Math.PI;
    scene.add(g);
  }

  /* ---------- links ---------- */
  const links = [];
  const incident = new Map(model.nodes.map((n) => [n, []]));
  for (const l of model.links) {
    const A = l.a.pos, B = l.b.pos;
    const ctrl = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, A.distanceTo(B) * 0.2, 0));
    const curve = new THREE.QuadraticBezierCurve3(A.clone(), ctrl, B.clone());
    const base = l.kind === 'stated' ? 0.6 : 0.16;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
      new THREE.LineBasicMaterial({ color: l.kind === 'stated' ? NEON : 0x2bd36f, transparent: true, opacity: base }));
    scene.add(line);
    const e = { ...l, curve, line, base, vis: base, visTarget: base };
    links.push(e);
    incident.get(l.a).push(e);
    incident.get(l.b).push(e);
  }

  /* ---------- agents wandering the network ---------- */
  const agents = [];
  const agentMat = new THREE.SpriteMaterial({ map: glow, color: 0xeafff2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const e of links) {
    for (let i = 0; i < (e.kind === 'stated' ? 2 : 1); i++) {
      const s = new THREE.Sprite(agentMat);
      s.scale.setScalar(0.8);
      scene.add(s);
      agents.push({ s, edge: e, dir: Math.random() < 0.5 ? 1 : -1, t: Math.random(), speed: 0.08 + Math.random() * 0.1 });
    }
  }

  /* ---------- labels ---------- */
  const labelFor = new Map();
  for (const n of model.nodes) {
    const el = document.createElement('div');
    el.className = 'label' + (n.isCore ? ' core' : '');
    el.textContent = shortName(n.name);
    el.addEventListener('pointerenter', () => setHover(n));
    el.addEventListener('pointerleave', () => setHover(null));
    el.addEventListener('click', () => select(n));
    labelsEl.append(el);
    labelFor.set(n, el);
  }

  /* ---------- focus ---------- */
  let hovered = null, selected = null;
  function refreshFocus() {
    const focus = hovered || selected;
    const lit = new Set(focus ? [focus, ...incident.get(focus).flatMap((e) => [e.a, e.b])] : []);
    for (const n of model.nodes) {
      n.lit = lit.has(n);
      n.visTarget = !focus || n.lit ? 1 : 0.15;
      n.scaleTarget = n === focus ? 1.18 : 1;
      labelFor.get(n).classList.toggle('hot', n === focus);
    }
    for (const e of links) e.visTarget = !focus ? e.base : (e.a === focus || e.b === focus) ? 1 : e.base * 0.15;
    for (const g of groups) g.visTarget = focus && g.members.includes(focus) ? 0.14 : focus ? 0.02 : g.base;
  }
  function setHover(n) {
    if (hovered === n) return;
    hovered = n;
    host.classList.toggle('pointing', !!n);
    refreshFocus();
  }

  /* ---------- camera ---------- */
  let flight = null;
  let lastInteraction = performance.now();
  const flyTo = (pos, target, dur = 1.4) => {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), dur: reducedMotion ? 0.01 : dur };
  };
  function flyToNode(n) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    dir.y = THREE.MathUtils.clamp(dir.y, 0.12, 0.55);
    dir.normalize();
    const dist = n.isCore ? 30 : 18 + n.size * 2.5;
    // Nudge the focus point right so the panel doesn't cover the cube.
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const target = n.pos.clone().add(right.multiplyScalar(dist * 0.2));
    flyTo(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  /* ---------- panel ---------- */
  const panel = document.getElementById('panel');
  function select(n) {
    selected = n;
    panel.hidden = false;
    panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
    const kicker = panel.querySelector('.panel-kicker');
    kicker.className = `panel-kicker st-${n.status}`;
    panel.querySelector('.panel-status').textContent = n.isCore ? 'global governance' : statusLabel(n.status);
    panel.querySelector('.panel-name').textContent = n.name;
    panel.querySelector('.panel-tagline').textContent = n.tagline || '';
    panel.querySelector('.panel-links').replaceChildren(...neighbours(model, n).map((o) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: shortName(o.name) });
      b.addEventListener('click', () => select(o));
      return b;
    }));
    const visit = panel.querySelector('.panel-visit');
    visit.hidden = !n.href;
    if (n.href) visit.href = n.href;
    flyToNode(n);
    history.replaceState(null, '', `#${n.id}`);
    refreshFocus();
  }
  function deselect(home) {
    selected = null;
    panel.hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    if (home) flyTo(HOME.pos, HOME.target, 1.6);
    refreshFocus();
  }
  const step = (d) => {
    const N = model.nodes.length;
    select(model.nodes[((selected ? selected.rank : -1) + d + N) % N]);
  };
  panel.querySelector('.panel-close').addEventListener('click', () => deselect(true));
  document.getElementById('btn-reset').addEventListener('click', () => deselect(true));
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') deselect(true);
  });

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.node : null;
  };
  const el = renderer.domElement;
  el.addEventListener('pointermove', (ev) => { if (!down) setHover(pick(ev)); });
  el.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; lastInteraction = performance.now(); flight = null; });
  el.addEventListener('pointerup', (ev) => {
    const click = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
    down = null;
    lastInteraction = performance.now();
    if (!click) return;
    const n = pick(ev);
    if (n) select(n); else if (selected) deselect(false);
  });
  el.addEventListener('pointerleave', () => setHover(null));
  el.addEventListener('wheel', () => { lastInteraction = performance.now(); flight = null; }, { passive: true });

  let W = innerWidth, H = innerHeight;
  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    composer.setSize(W, H);
  });

  /* ---------- loop ---------- */
  const tmp = new THREE.Vector3();
  const up = new THREE.Vector3();
  const clock = new THREE.Clock();
  function place(label, world) {
    tmp.copy(world).project(camera);
    if (tmp.z > 1 || tmp.z < -1) { label.style.visibility = 'hidden'; return false; }
    label.style.visibility = '';
    label.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * H - 4).toFixed(1)}px, 0) translate(-50%, -100%)`;
    return true;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const motion = reducedMotion ? 0.15 : 1;
    const k = Math.min(1, dt * 6);

    if (flight) {
      const p = Math.min(1, (performance.now() - flight.start) / (flight.dur * 1000));
      camera.position.lerpVectors(flight.p0, flight.p1, ease(p));
      controls.target.lerpVectors(flight.t0, flight.t1, ease(p));
      if (p >= 1) flight = null;
    }
    controls.autoRotate = !reducedMotion && !selected && !hovered && !flight && performance.now() - lastInteraction > 7000;
    controls.update();

    for (const n of model.nodes) {
      n.vis += (n.visTarget - n.vis) * k;
      for (const { m, base } of n.mats) m.opacity = base * n.vis;
      n.obj.scale.setScalar(n.obj.scale.x + (n.scaleTarget - n.obj.scale.x) * Math.min(1, dt * 8));
      n.obj.rotation.y += n.spin * dt * motion;
      n.obj.position.y = n.pos.y + Math.sin(t * 0.6 + n.rank) * 0.25 * motion;
      n.inner.rotation.x += dt * 0.5 * motion;
      n.inner.rotation.y -= dt * 0.7 * motion;
      if (n.isCore) {
        const beat = 1 + Math.pow(Math.max(0, Math.sin(t * 2.4)), 12) * 0.22;
        n.heart.scale.setScalar(beat);
        n.heartGlow.scale.setScalar(6 * beat);
        n.heart.rotation.y = Math.sin(t * 0.5) * 0.6 - n.obj.rotation.y;
        n.twin.rotation.x += dt * 0.2 * motion;
        n.meta.rotation.y -= dt * 0.12 * motion;
      }
    }
    for (const e of links) { e.vis += (e.visTarget - e.vis) * k; e.line.material.opacity = e.vis; }
    for (const g of groups) {
      g.vis += ((g.visTarget ?? g.base) - g.vis) * k;
      g.shell.material.opacity = g.vis;
      g.shell.rotation.y += g.shell.userData.spin * dt * motion;
    }
    for (const a of agents) {
      a.t += a.dir * a.speed * dt * motion;
      if (a.t > 1 || a.t < 0) {
        const at = a.t > 1 ? a.edge.b : a.edge.a;
        const opts = incident.get(at);
        a.edge = opts[(Math.random() * opts.length) | 0];
        a.dir = a.edge.a === at ? 1 : -1;
        a.t = a.dir === 1 ? 0 : 1;
      }
      a.edge.curve.getPoint(a.t, a.s.position);
      a.s.scale.setScalar(0.8 * Math.min(1, Math.max(a.edge.vis / a.edge.base, 0.25)));
    }
    for (const r of ripples) {
      const p = (t * 0.12 * motion + r.userData.phase) % 1;
      r.scale.setScalar(3 + p * R * 1.5);
      r.material.opacity = (1 - p) * (1 - p) * 0.2;
    }

    // Names stay hidden until they matter: the core always, otherwise focus or proximity.
    const focus = hovered || selected;
    for (const n of model.nodes) {
      const label = labelFor.get(n);
      up.set(0, n.size * 0.62 * n.obj.scale.x + 0.35, 0).add(n.obj.position);
      if (!place(label, up)) continue;
      const dist = camera.position.distanceTo(n.obj.position);
      label.classList.toggle('show', n.isCore || n.lit || (!focus && dist < 24));
      label.style.zIndex = String(1000 - Math.round(dist));
    }
    for (const g of groups) {
      place(g.el, g.top);
      g.el.classList.toggle('show', !focus || g.members.includes(focus));
    }
    composer.render();
  }

  flyTo(HOME.pos, HOME.target, reducedMotion ? 0.01 : 2.6);
  refreshFocus();
  requestAnimationFrame(frame);
  const fromHash = model.nodes.find((n) => `#${n.id}` === location.hash);
  if (fromHash) setTimeout(() => select(fromHash), reducedMotion ? 0 : 2300);
}
