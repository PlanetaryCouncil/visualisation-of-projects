// The 3D map, built for speed: no post-processing, no idle animation, and a
// frame is drawn only when something changed (orbit, zoom, hover, edit).
//
// Lines come from the source data:
//   part_of     -> single line (parent -> child)
//   connects_to -> double line (siblings)
//   standalone  -> drawn as a triangular pyramid instead of a cube
// Positions and sizes saved in data/layout.json win; any project missing
// there is placed by a small force simulation (lines, cluster, shared tags).
//
// Editing (press E, or hold Alt):
//   Alt + drag a project          move it (in the plane facing you)
//   Alt + scroll over a project   make it bigger / smaller (thicker border)
//   E opens the editor box, with tools:
//     parent  -> drag from the parent to the child (single line)
//     sibling -> drag from one project to the other (double line)
//     shape   -> click a project: cube <-> pyramid (standalone)
//   Dragging the same line again removes it.
// The box holds the whole arrangement as JSON to paste back into the data.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const NEON = 0x39ff88;
const BORDER_PX = 1.3;                       // border width at size 1
const SIZE_MIN = 0.4, SIZE_MAX = 4;
const DRAFT_KEY = 'projects-multiverse:draft-v2';

const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; } };
const round = (v) => Math.round(v * 10) / 10;

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function layout(model, saved) {
  const N = model.nodes;
  const rnd = seeded(N.map((n) => n.name).join('|'));
  for (const n of N) {
    const s = saved[n.name]?.pos;
    const ok = Array.isArray(s) && s.length === 3;
    n.fixed = ok || n.isCore;
    n.p = ok ? new THREE.Vector3(...s) : n.isCore ? new THREE.Vector3()
      : new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30);
    n.v = new THREE.Vector3();
  }
  if (N.some((n) => !n.fixed)) {
    const springs = [];
    for (const l of model.links) springs.push({ a: l.a, b: l.b, rest: l.kind === 'parent' ? 7 : 9, k: l.kind === 'parent' ? 0.07 : 0.05 });
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const shared = N[i].tags.filter((t) => N[j].tags.includes(t)).length;
      if (N[i].cluster && N[i].cluster === N[j].cluster) springs.push({ a: N[i], b: N[j], rest: 9, k: 0.03 });
      else if (shared) springs.push({ a: N[i], b: N[j], rest: 12, k: 0.006 * shared });
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
        if (n.fixed) { n.v.set(0, 0, 0); continue; }
        n.v.addScaledVector(n.p, -0.009);
        n.v.y -= n.p.y * 0.006;
        n.v.multiplyScalar(0.82);
        n.p.addScaledVector(n.v, 0.6 + cool);
      }
    }
  }
  for (const n of N) { n.start = n.p; delete n.p; delete n.v; }
}

// Where a line meets a surface: a small static burst (bright core, soft glow,
// a few short rays) so the line ends in a touch of energy, not a cut.
function splashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  g.translate(32, 32);
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4);
    const len = i % 2 ? 17 : 26;
    const ray = g.createLinearGradient(0, 0, len, 0);
    ray.addColorStop(0, 'rgba(255,255,255,.7)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.fillRect(0, -0.6, len, 1.2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,.5)');
  grd.addColorStop(0.55, 'rgba(255,255,255,.1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function startScene(model, { neighbours, shortName, statusLabel, layoutUrl }) {
  let saved = {};
  try {
    const r = await fetch(layoutUrl, { cache: 'no-cache' });
    if (r.ok) saved = await r.json();
  } catch { /* nothing saved: everything is auto-placed */ }
  const byName = new Map(model.nodes.map((n) => [n.name, n]));
  const draft = readDraft();
  if (draft?.layout) saved = { ...saved, ...draft.layout };
  if (Array.isArray(draft?.lines)) {
    model.links = draft.lines
      .map(([a, b, kind]) => ({ a: byName.get(a), b: byName.get(b), kind }))
      .filter((l) => l.a && l.b && (l.kind === 'parent' || l.kind === 'sibling'));
  }

  if (Array.isArray(draft?.standalone)) {
    const set = new Set(draft.standalone);
    for (const n of model.nodes) n.standalone = set.has(n.name);
  }

  document.getElementById('stage').hidden = false;
  const host = document.getElementById('gl');
  const labelsEl = document.getElementById('labels');
  layout(model, saved);

  const radii = model.nodes.map((n) => n.start.length()).sort((a, b) => a - b);
  const R = radii[Math.floor(radii.length * 0.85)] + 4;
  const centre = model.nodes.reduce((acc, n) => acc.add(n.start), new THREE.Vector3()).divideScalar(model.nodes.length);
  const HOME = { pos: centre.clone().add(new THREE.Vector3(0, R * 0.5, R * 1.75)), target: centre };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  host.append(renderer.domElement);
  let W = innerWidth, H = innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020805);
  scene.fog = new THREE.FogExp2(0x020805, 0.005);
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1500);
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 6;
  controls.maxDistance = R * 5;
  controls.maxPolarAngle = Math.PI * 0.85;

  // Fat-line materials need the canvas size in pixels.
  const fatMaterials = new Set();
  const fat = (opts) => {
    const m = new LineMaterial({ transparent: true, ...opts });
    m.resolution.set(W, H);
    fatMaterials.add(m);
    return m;
  };

  const glow = glowTexture();
  const splash = splashTexture();

  /* ---------- stars (static) ---------- */
  {
    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 180 + Math.random() * 380, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7 + 30, r * Math.sin(ph) * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7dffb0, size: 0.9, transparent: true, opacity: 0.45, fog: false })));
  }

  /* ---------- nodes: one colour; size = attention; cube or pyramid ---------- */
  const pickables = [];
  const PYR_R = 0.85, PYR_H = 1.35;    // pyramid: base circumradius and height, × size
  const bodyGeometry = (n) => n.standalone
    ? new THREE.ConeGeometry(n.size * PYR_R, n.size * PYR_H, 3, 1)      // triangular pyramid
    : new THREE.BoxGeometry(n.size, n.size, n.size);
  // Is a world point inside a project's body (at its resting size, ignoring hover)?
  const local = new THREE.Vector3(), invQ = new THREE.Quaternion();
  const EDGE_DIRS = [Math.PI / 3, Math.PI, (5 * Math.PI) / 3].map((a) => [Math.sin(a), Math.cos(a)]);
  function inside(n, p) {
    local.subVectors(p, n.pos).applyQuaternion(invQ.copy(n.obj.quaternion).invert()).divideScalar(n.k);
    if (!n.standalone) {
      const h = n.size / 2;
      return Math.abs(local.x) <= h && Math.abs(local.y) <= h && Math.abs(local.z) <= h;
    }
    const ph = n.size * PYR_H;
    if (local.y < -ph / 2 || local.y > ph / 2) return false;
    const rho = n.size * PYR_R * (0.5 - local.y / ph);      // cross-section circumradius at this height
    return EDGE_DIRS.every(([dx, dz]) => local.x * dx + local.z * dz <= rho / 2);
  }
  function buildBody(n) {
    if (n.body) {
      n.obj.remove(n.body);
      pickables.splice(pickables.indexOf(n.face), 1);
      fatMaterials.delete(n.borderMat);
      n.body.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    const body = new THREE.Group();
    const geo = bodyGeometry(n);
    const face = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.08, depthWrite: false }));
    face.userData.node = n;
    pickables.push(face);
    const borderMat = fat({ color: NEON, linewidth: BORDER_PX * n.k, opacity: 1 });
    const border = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo)), borderMat);
    body.add(face, border);
    n.obj.add(body);
    Object.assign(n, { body, face, borderMat });
    n.mats = [{ m: face.material, base: 0.08 }, { m: borderMat, base: 1 }, n.haloMat];
  }
  for (const n of model.nodes) {
    n.size = n.isCore ? 4.4 : Math.max(1.6, 2.8 - n.rank * 0.05);
    n.k = THREE.MathUtils.clamp(Number(saved[n.name]?.size) || 1, SIZE_MIN, SIZE_MAX);
    const g = new THREE.Group();
    g.position.copy(n.start);
    g.rotation.set(0.15, (n.rank * 0.7) % Math.PI, 0);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: NEON, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(n.size * 2);
    g.add(halo);
    n.obj = g;
    n.haloMat = { m: halo.material, base: 0.25 };
    buildBody(n);
    n.pos = g.position;              // one vector: moving the group moves the project
    scene.add(g);
  }
  const applySize = (n, focus) => {
    n.obj.scale.setScalar(n.k * (n === focus ? 1.12 : 1));
    n.borderMat.linewidth = BORDER_PX * n.k * (n === focus ? 1.3 : 1);
  };

  /* ---------- lines: single = parent -> child, double = siblings ---------- */
  const LINE_PX = 1.3;
  const LINE_BASE = 0.7;
  const GAP_PX = 1.4;                // half the gap between the two strands of a sibling line
  const incident = new Map(model.nodes.map((n) => [n, []]));
  // The curve from A's centre to B's centre, trimmed so it starts and ends
  // where it crosses each project's surface.
  const cp = new THREE.Vector3();
  const curvePts = (a, b) => {
    const A = a.pos, B = b.pos;
    const ctrl = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, A.distanceTo(B) * 0.2, 0));
    const c = new THREE.QuadraticBezierCurve3(A, ctrl, B);
    const edge = (n, lo, hi) => {          // lo is inside n, hi is outside
      if (!inside(n, c.getPoint(lo, cp)) || inside(n, c.getPoint(hi, cp))) return lo;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (inside(n, c.getPoint(mid, cp))) lo = mid; else hi = mid;
      }
      return hi;
    };
    const t0 = edge(a, 0, 0.5);
    const t1 = edge(b, 1, 0.5);
    if (t1 <= t0) return [c.getPoint(0.5), c.getPoint(0.5)];   // overlapping bodies
    return Array.from({ length: 25 }, (_, i) => c.getPoint(t0 + ((t1 - t0) * i) / 24));
  };
  const flat = (pts) => pts.flatMap((p) => [p.x, p.y, p.z]);
  // A sibling line is two strands, offset sideways as seen from the camera,
  // so it reads as a double line from any angle (recomputed when the view moves).
  const pxToWorld = (p) => camera.position.distanceTo(p) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2 / H;
  const tA = new THREE.Vector3(), vA = new THREE.Vector3(), nA = new THREE.Vector3();
  function redrawLink(l) {
    const pts = curvePts(l.a, l.b);
    l.splashes[0].position.copy(pts[0]);
    l.splashes[1].position.copy(pts[pts.length - 1]);
    if (l.kind === 'parent') { l.lines[0].geometry.setPositions(flat(pts)); return; }
    const left = [], right = [];
    pts.forEach((p, i) => {
      tA.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]);
      vA.subVectors(camera.position, p);
      nA.crossVectors(tA, vA).normalize().multiplyScalar(GAP_PX * pxToWorld(p));
      left.push(p.x + nA.x, p.y + nA.y, p.z + nA.z);
      right.push(p.x - nA.x, p.y - nA.y, p.z - nA.z);
    });
    l.lines[0].geometry.setPositions(left);
    l.lines[1].geometry.setPositions(right);
  }
  function drawLink(l) {
    l.base = LINE_BASE;
    l.lines = Array.from({ length: l.kind === 'parent' ? 1 : 2 }, () =>
      new Line2(new LineGeometry(), fat({ color: NEON, opacity: LINE_BASE, linewidth: LINE_PX })));
    l.splashes = [0, 1].map(() => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: splash, color: NEON, transparent: true, opacity: LINE_BASE, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.setScalar(1.3);
      return sp;
    });
    redrawLink(l);
    for (const ln of [...l.lines, ...l.splashes]) scene.add(ln);
    incident.get(l.a).push(l);
    incident.get(l.b).push(l);
  }
  function eraseLink(l) {
    for (const sp of l.splashes) { scene.remove(sp); sp.material.dispose(); }
    for (const ln of l.lines) {
      scene.remove(ln);
      ln.geometry.dispose();
      fatMaterials.delete(ln.material);
      ln.material.dispose();
    }
    for (const n of [l.a, l.b]) incident.set(n, incident.get(n).filter((x) => x !== l));
    model.links.splice(model.links.indexOf(l), 1);
  }
  const siblingLines = () => model.links.filter((l) => l.kind === 'sibling');
  model.links.forEach(drawLink);

  /* ---------- labels: always on ---------- */
  const labelFor = new Map();
  for (const n of model.nodes) {
    const el = document.createElement('div');
    el.className = 'label show' + (n.isCore ? ' core' : '');
    el.textContent = shortName(n.name);
    el.addEventListener('pointerenter', () => setHover(n));
    el.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
    el.addEventListener('pointerdown', (ev) => { if (beginEdit(n, ev)) ev.stopPropagation(); });
    el.addEventListener('click', () => { if (!justEdited) select(n); });
    el.addEventListener('wheel', (ev) => onWheel(ev, n), { passive: false });
    labelsEl.append(el);
    labelFor.set(n, el);
  }

  /* ---------- render on demand ---------- */
  let dirty = true;
  const invalidate = () => { dirty = true; };
  controls.addEventListener('change', invalidate);

  /* ---------- focus ---------- */
  let hovered = null, selected = null;
  function refreshFocus() {
    const focus = hovered || selected;
    const lit = new Set(focus ? [focus, ...incident.get(focus).flatMap((e) => [e.a, e.b])] : []);
    for (const n of model.nodes) {
      n.lit = lit.has(n);
      const v = !focus || n.lit ? 1 : 0.15;
      for (const { m, base } of n.mats) m.opacity = base * v;
      applySize(n, focus);
      labelFor.get(n).classList.toggle('hot', n === focus);
      labelFor.get(n).classList.toggle('dim', !!focus && !n.lit);
    }
    for (const l of model.links) {
      const o = !focus ? l.base : (l.a === focus || l.b === focus) ? 1 : l.base * 0.15;
      for (const ln of [...l.lines, ...l.splashes]) ln.material.opacity = o;
    }
    invalidate();
  }
  function setHover(n) {
    if (hovered === n) return;
    hovered = n;
    host.classList.toggle('pointing', !!n);
    refreshFocus();
  }

  /* ---------- camera: one short, simple move ---------- */
  let flight = null;
  const flyTo = (pos, target) => {
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), dur: 450 };
    invalidate();
  };
  function flyToNode(n) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    dir.y = THREE.MathUtils.clamp(dir.y, 0.12, 0.55);
    dir.normalize();
    const dist = n.isCore ? 30 : 18 + n.size * n.k * 2.5;
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const target = n.pos.clone().add(right.multiplyScalar(dist * 0.2));
    flyTo(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  /* ---------- panel ---------- */
  const panel = document.getElementById('panel');
  function select(n) {
    selected = n;
    panel.hidden = false;
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
    if (home) flyTo(HOME.pos, HOME.target);
    refreshFocus();
  }
  const step = (d) => {
    const N = model.nodes.length;
    select(model.nodes[((selected ? selected.rank : -1) + d + N) % N]);
  };
  panel.querySelector('.panel-close').addEventListener('click', () => deselect(true));
  document.getElementById('btn-reset').addEventListener('click', () => deselect(true));

  /* ---------- picking ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pick = (ev) => {
    aim(ev);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.node : null;
  };
  const nodeUnder = (ev) => {
    const label = document.elementFromPoint(ev.clientX, ev.clientY);
    const fromLabel = label && [...labelFor].find(([, el]) => el === label)?.[0];
    return fromLabel || pick(ev);
  };

  /* ---------- editing ---------- */
  const editor = document.getElementById('editor');
  const editorText = editor.querySelector('textarea');
  let tool = 'move';
  let drag = null;           // { n, mode: 'move' | 'parent' | 'sibling', offset }
  let justEdited = false;
  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const preview = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  preview.visible = false;
  preview.frustumCulled = false;
  scene.add(preview);
  const setPreviewEnd = (i, v) => {
    preview.geometry.attributes.position.setXYZ(i, v.x, v.y, v.z);
    preview.geometry.attributes.position.needsUpdate = true;
  };

  const onPlane = (ev) => { aim(ev); return ray.ray.intersectPlane(plane, hitPoint); };

  // Returns true when the pointer-down started an edit (so orbit/select stay out of it).
  function beginEdit(n, ev) {
    const mode = ev.altKey ? 'move' : !editor.hidden ? tool : null;
    if (!mode || ev.button !== 0) return false;
    ev.preventDefault();
    if (mode === 'shape') {
      n.standalone = !n.standalone;
      buildBody(n);
      for (const l of incident.get(n)) redrawLink(l);
      justEdited = true;
      setTimeout(() => { justEdited = false; }, 0);
      saveDraft();
      refreshFocus();
      return true;
    }
    controls.enabled = false;
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), n.pos);
    const hit = onPlane(ev);
    drag = { n, mode, offset: hit ? n.pos.clone().sub(hit) : new THREE.Vector3() };
    if (mode !== 'move') {
      setPreviewEnd(0, n.pos);
      setPreviewEnd(1, n.pos);
      preview.visible = true;
    }
    setHover(n);
    return true;
  }
  addEventListener('pointermove', (ev) => {
    if (!drag || !onPlane(ev)) return;
    if (drag.mode === 'move') {
      drag.n.pos.copy(hitPoint).add(drag.offset);
      for (const l of incident.get(drag.n)) redrawLink(l);
    } else {
      const over = nodeUnder(ev);
      setPreviewEnd(1, over && over !== drag.n ? over.pos : hitPoint);
    }
    invalidate();
  });
  addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const { n, mode } = drag;
    drag = null;
    controls.enabled = true;
    preview.visible = false;
    if (mode !== 'move') {
      const target = nodeUnder(ev);
      if (target && target !== n) toggleLine(n, target, mode);
    }
    justEdited = true;
    setTimeout(() => { justEdited = false; }, 0);
    saveDraft();
    refreshFocus();
  });

  function toggleLine(A, B, kind) {
    const had = model.links.find((l) => (l.a === A && l.b === B) || (l.a === B && l.b === A));
    const sameAgain = had && had.kind === kind && (kind === 'sibling' || had.a === A);
    if (had) eraseLink(had);
    if (!sameAgain) {
      const l = { a: A, b: B, kind };     // parent line: a = parent, b = child
      model.links.push(l);
      drawLink(l);
    }
  }

  let wheelTarget = null, wheelAt = 0;
  function onWheel(ev, n) {
    if (!ev.altKey && editor.hidden) return;
    // Keep resizing the same project while the wheel keeps turning, even after
    // it has grown out from under the pointer.
    if (performance.now() - wheelAt < 400 && wheelTarget) n = wheelTarget;
    n = n || pick(ev);
    if (!n) return;               // over empty space: normal zoom
    wheelTarget = n;
    wheelAt = performance.now();
    ev.preventDefault();
    ev.stopPropagation();
    n.k = THREE.MathUtils.clamp(n.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), SIZE_MIN, SIZE_MAX);
    for (const l of incident.get(n)) redrawLink(l);
    refreshFocus();
    clearTimeout(onWheel.t);
    onWheel.t = setTimeout(saveDraft, 250);
  }
  // Capture phase on the parent, so a resize never reaches OrbitControls' zoom.
  host.addEventListener('wheel', (ev) => onWheel(ev), { passive: false, capture: true });

  const snapshot = () => ({
    layout: Object.fromEntries(model.nodes.map((n) => [n.name, { pos: n.pos.toArray().map(round), size: round(n.k) }])),
    lines: model.links.map((l) => [l.a.name, l.b.name, l.kind]),
    standalone: model.nodes.filter((n) => n.standalone).map((n) => n.name),
  });
  function exportText() {
    const s = snapshot();
    const part_of = {}, connects_to = {};
    for (const [a, b, kind] of s.lines) {
      if (kind === 'parent') (part_of[b] ||= []).push(a);
      else (connects_to[a] ||= []).push(b);
    }
    const rows = (o) => Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    return `{\n  "layout": {\n${rows(s.layout)}\n  },\n  "part_of": {\n${rows(part_of)}\n  },\n  "connects_to": {\n${rows(connects_to)}\n  },\n  "standalone": ${JSON.stringify(s.standalone)}\n}`;
  }
  function showEditor() {
    editor.hidden = false;
    editorText.value = exportText();
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch { /* private mode */ }
    showEditor();
  }
  const toolButtons = [...editor.querySelectorAll('[data-tool]')];
  const setTool = (t) => {
    tool = t;
    for (const b of toolButtons) b.classList.toggle('on', b.dataset.tool === t);
  };
  for (const b of toolButtons) b.addEventListener('click', () => setTool(b.dataset.tool));
  setTool('move');
  editor.querySelector('.ed-copy').addEventListener('click', async () => {
    editorText.select();
    try { await navigator.clipboard.writeText(editorText.value); } catch { document.execCommand('copy'); }
    const b = editor.querySelector('.ed-copy');
    b.textContent = 'copied';
    setTimeout(() => { b.textContent = 'copy'; }, 1200);
  });
  editor.querySelector('.ed-discard').addEventListener('click', () => {
    if (!confirm('Throw away your unsaved arrangement?')) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    location.reload();
  });
  editor.querySelector('.ed-close').addEventListener('click', () => { editor.hidden = true; });
  if (draft) showEditor();

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('textarea, input')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') deselect(true);
    else if (e.key === 'e' || e.key === 'E') { if (editor.hidden) showEditor(); else editor.hidden = true; }
    else if (e.key === 'Alt') e.preventDefault();   // keep Firefox's menu bar from grabbing focus
  });

  /* ---------- pointer on the canvas ---------- */
  let down = null, pendingMove = null;
  const el = renderer.domElement;
  el.addEventListener('pointermove', (ev) => { if (!down && !drag) pendingMove = ev; });
  el.addEventListener('pointerdown', (ev) => {
    flight = null;
    const n = (ev.altKey || !editor.hidden) ? pick(ev) : null;
    if (n && beginEdit(n, ev)) return;
    down = { x: ev.clientX, y: ev.clientY };
  });
  el.addEventListener('pointerup', (ev) => {
    if (justEdited) { down = null; return; }
    const click = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
    down = null;
    if (!click) return;
    const n = pick(ev);
    if (n) select(n); else if (selected) deselect(false);
  });
  el.addEventListener('pointerleave', () => { pendingMove = null; if (!drag) setHover(null); });

  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    for (const m of fatMaterials) m.resolution.set(W, H);
    siblingLines().forEach(redrawLink);
    invalidate();
  });

  /* ---------- loop ---------- */
  const tmp = new THREE.Vector3();
  const up = new THREE.Vector3();
  function place(label, world) {
    tmp.copy(world).project(camera);
    if (tmp.z > 1 || tmp.z < -1) { label.style.visibility = 'hidden'; return false; }
    label.style.visibility = '';
    label.style.transform = `translate3d(${((tmp.x * 0.5 + 0.5) * W) | 0}px, ${((-tmp.y * 0.5 + 0.5) * H - 4) | 0}px, 0) translate(-50%, -100%)`;
    return true;
  }

  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  function frame() {
    requestAnimationFrame(frame);
    if (pendingMove) { setHover(pick(pendingMove)); pendingMove = null; }
    if (flight) {
      const p = Math.min(1, (performance.now() - flight.start) / flight.dur);
      const e = 1 - Math.pow(1 - p, 3);
      camera.position.lerpVectors(flight.p0, flight.p1, e);
      controls.target.lerpVectors(flight.t0, flight.t1, e);
      if (p >= 1) flight = null;
      dirty = true;
    }
    controls.update();               // fires 'change' (and so dirty) only while moving
    if (!dirty) return;
    dirty = false;
    if (!camera.position.equals(lastCam)) { lastCam.copy(camera.position); siblingLines().forEach(redrawLink); }

    for (const n of model.nodes) {
      const label = labelFor.get(n);
      up.set(0, n.size * 0.62 * n.obj.scale.x + 0.35, 0).add(n.obj.position);
      if (!place(label, up)) continue;
      label.style.zIndex = String(1000 - Math.round(camera.position.distanceTo(n.obj.position)));
    }
    renderer.render(scene, camera);
  }

  refreshFocus();
  requestAnimationFrame(frame);
  const fromHash = model.nodes.find((n) => `#${n.id}` === location.hash);
  if (fromHash) select(fromHash);
}
