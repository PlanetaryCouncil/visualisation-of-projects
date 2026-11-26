// The 3D map, built for speed: no post-processing, no idle animation, and a
// frame is drawn only when something changed (orbit, zoom, hover, camera move).
//
// Layout: positions saved in data/positions.json win. Any project without a
// saved position is placed by a small force simulation from the source data:
//   - connects_to = strong springs and visible lines,
//   - same cluster = medium springs,
//   - shared tags = weak springs,
//   - everything repels a little; the core (hq) sits at the centre.
//
// Editing: hold Alt (Option on a Mac) and drag a project. It moves in the plane
// facing you; orbit the view to move it in depth. A box at the bottom then holds
// every position as JSON, ready to paste into data/positions.json.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STATUS_COLOR = { 'active': 0x39ff88, 'awaiting-deployment': 0xffc857, 'done': 0x5ce1ff, 'for-sale': 0xff5c8a };
const NEON = 0x39ff88;
const LOVE = 0xff3b3b;

function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function layout(model, saved) {
  const N = model.nodes;
  const rnd = seeded(N.map((n) => n.name).join('|'));
  for (const n of N) {
    const s = saved[n.name];
    n.fixed = Array.isArray(s) && s.length === 3 || n.isCore;
    n.p = Array.isArray(s) && s.length === 3 ? new THREE.Vector3(...s)
      : n.isCore ? new THREE.Vector3()
      : new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30);
    n.v = new THREE.Vector3();
  }
  if (N.every((n) => n.fixed)) { for (const n of N) { n.pos = n.p; delete n.p; delete n.v; } return; }
  const springs = [];
  for (const l of model.links) springs.push({ a: l.a, b: l.b, rest: l.kind === 'stated' ? 8 : 9, k: l.kind === 'stated' ? 0.06 : 0.04 });
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const shared = N[i].tags.filter((t) => N[j].tags.includes(t)).length;
    const same = N[i].cluster && N[i].cluster === N[j].cluster;
    if (same) springs.push({ a: N[i], b: N[j], rest: 9, k: 0.03 });
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
      n.v.addScaledVector(n.p, -0.009);
      n.v.y -= n.p.y * 0.006;
      if (n.fixed) { n.v.set(0, 0, 0); continue; }
      n.v.multiplyScalar(0.82);
      n.p.addScaledVector(n.v, 0.6 + cool);
    }
  }
  for (const n of N) { n.pos = n.p; delete n.p; delete n.v; }
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

function heartGeometry() {
  const s = new THREE.Shape();
  s.moveTo(25, 25);
  s.bezierCurveTo(25, 25, 20, 0, 0, 0);
  s.bezierCurveTo(-30, 0, -30, 35, -30, 35);
  s.bezierCurveTo(-30, 55, -10, 77, 25, 95);
  s.bezierCurveTo(60, 77, 80, 55, 80, 35);
  s.bezierCurveTo(80, 35, 80, 0, 50, 0);
  s.bezierCurveTo(35, 0, 25, 25, 25, 25);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 18, bevelEnabled: true, bevelSize: 6, bevelThickness: 6, bevelSegments: 2, curveSegments: 12 });
  geo.center();
  geo.rotateZ(Math.PI);
  geo.scale(0.034, 0.034, 0.034);
  return geo;
}

const DRAFT_KEY = 'projects-multiverse:positions-draft';
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || null; } catch { return null; } };

export async function startScene(model, { neighbours, shortName, statusLabel, positionsUrl }) {
  let saved = {};
  try {
    const r = await fetch(positionsUrl, { cache: 'no-cache' });
    if (r.ok) saved = await r.json();
  } catch { /* no saved positions: everything is auto-placed */ }
  const draft = readDraft();
  if (draft) saved = { ...saved, ...draft };

  document.getElementById('stage').hidden = false;
  const host = document.getElementById('gl');
  const labelsEl = document.getElementById('labels');
  layout(model, saved);

  const radii = model.nodes.map((n) => n.pos.length()).sort((a, b) => a - b);
  const R = radii[Math.floor(radii.length * 0.85)] + 4;
  const centre = model.nodes.reduce((acc, n) => acc.add(n.pos), new THREE.Vector3()).divideScalar(model.nodes.length);
  const HOME = { pos: centre.clone().add(new THREE.Vector3(0, R * 0.5, R * 1.75)), target: centre };

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020805);
  scene.fog = new THREE.FogExp2(0x020805, 0.005);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1500);
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 6;
  controls.maxDistance = R * 5;
  controls.maxPolarAngle = Math.PI * 0.85;

  const glow = glowTexture();

  /* ---------- environment (static) ---------- */
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

  /* ---------- cluster names (no shells) ---------- */
  const groups = [];
  const byCluster = new Map();
  for (const n of model.nodes) if (n.cluster) byCluster.set(n.cluster, [...(byCluster.get(n.cluster) || []), n]);
  for (const [name, members] of byCluster) {
    if (members.length < 2) continue;
    const el = document.createElement('div');
    el.className = 'label group show';
    el.textContent = name;
    labelsEl.append(el);
    groups.push({ members, el, top: new THREE.Vector3() });
  }
  const placeGroups = () => {
    for (const g of groups) {
      const c = g.members.reduce((acc, n) => acc.add(n.pos), new THREE.Vector3()).divideScalar(g.members.length);
      const r = Math.max(...g.members.map((n) => n.pos.distanceTo(c)));
      g.top.copy(c).y += r + 2;
    }
  };

  /* ---------- nodes ---------- */
  const pickables = [];
  for (const n of model.nodes) {
    const color = new THREE.Color(n.isCore ? NEON : STATUS_COLOR[n.status] || NEON);
    const size = n.isCore ? 4.4 : Math.max(1.6, 2.8 - n.rank * 0.05);
    n.size = size;
    const g = new THREE.Group();
    g.position.copy(n.pos);
    g.rotation.set(0.15, (n.rank * 0.7) % Math.PI, 0);
    const box = new THREE.BoxGeometry(size, size, size);
    const face = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
    face.userData.node = n;
    pickables.push(face);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(size * 2);
    g.add(face, edges, halo);
    const mats = [{ m: face.material, base: 0.08 }, { m: edges.material, base: 1 }, { m: halo.material, base: 0.25 }];
    if (n.isCore) {
      halo.material.opacity = mats[2].base = 0.05;
      const heart = new THREE.Mesh(heartGeometry(), new THREE.MeshBasicMaterial({ color: LOVE }));
      heart.rotation.y = -g.rotation.y;
      const heartGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: LOVE, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      heartGlow.scale.setScalar(7);
      const twin = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: NEON, transparent: true, opacity: 0.45 }));
      twin.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      g.add(heart, heartGlow, twin);
      mats.push({ m: twin.material, base: 0.45 });
    } else {
      const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 0.38, size * 0.38, size * 0.38)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
      inner.rotation.set(0.6, 0.8, 0);
      g.add(inner);
      mats.push({ m: inner.material, base: 0.6 });
    }
    Object.assign(n, { obj: g, mats });
    n.pos = g.position;              // one vector: moving the group moves the project
    scene.add(g);
  }

  /* ---------- links ---------- */
  const links = [];
  const incident = new Map(model.nodes.map((n) => [n, []]));
  const curvePoints = (A, B) => {
    const ctrl = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, A.distanceTo(B) * 0.2, 0));
    return new THREE.QuadraticBezierCurve3(A, ctrl, B).getPoints(24);
  };
  const redrawLink = (e) => {
    const attr = e.line.geometry.attributes.position;
    curvePoints(e.a.pos, e.b.pos).forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
    attr.needsUpdate = true;
    e.line.geometry.computeBoundingSphere();
  };
  for (const l of model.links) {
    const pts = curvePoints(l.a.pos, l.b.pos);
    const base = l.kind === 'stated' ? 0.6 : 0.18;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: l.kind === 'stated' ? NEON : 0x2bd36f, transparent: true, opacity: base }));
    scene.add(line);
    const e = { ...l, line, base };
    links.push(e);
    incident.get(l.a).push(e);
    incident.get(l.b).push(e);
  }

  /* ---------- labels ---------- */
  const labelFor = new Map();
  for (const n of model.nodes) {
    const el = document.createElement('div');
    el.className = 'label show' + (n.isCore ? ' core' : '');
    el.textContent = shortName(n.name);
    el.addEventListener('pointerenter', () => setHover(n));
    el.addEventListener('pointerleave', () => setHover(null));
    el.addEventListener('click', (ev) => { if (!ev.altKey) select(n); });
    el.addEventListener('pointerdown', (ev) => { if (ev.altKey) startDrag(n, ev); });
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
      n.obj.scale.setScalar(n === focus ? 1.15 : 1);
      labelFor.get(n).classList.toggle('hot', n === focus);
      labelFor.get(n).classList.toggle('dim', !!focus && !n.lit);
    }
    for (const e of links) e.line.material.opacity = !focus ? e.base : (e.a === focus || e.b === focus) ? 1 : e.base * 0.15;
    for (const g of groups) g.el.classList.toggle('show', !focus || g.members.includes(focus));
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
    const dist = n.isCore ? 30 : 18 + n.size * 2.5;
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const target = n.pos.clone().add(right.multiplyScalar(dist * 0.2));
    flyTo(target.clone().add(dir.multiplyScalar(dist)), target);
  }

  /* ---------- panel ---------- */
  const panel = document.getElementById('panel');
  function select(n) {
    selected = n;
    panel.hidden = false;
    panel.querySelector('.panel-kicker').className = `panel-kicker st-${n.status}`;
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
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('textarea, input')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') deselect(true);
    else if (e.key === 'Alt') e.preventDefault();   // keep Firefox's menu bar from grabbing focus
  });

  /* ---------- picking (throttled to one raycast per frame) ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null, pendingMove = null;
  const pick = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.node : null;
  };
  const el = renderer.domElement;
  el.addEventListener('pointermove', (ev) => { if (!down && !drag) pendingMove = ev; });

  /* ---------- editing: Alt + drag moves a project ---------- */
  let drag = null;
  const plane = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  const rayAt = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hitPoint);
  };
  function startDrag(n, ev) {
    ev.preventDefault();
    controls.enabled = false;
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), n.pos);
    const hit = rayAt(ev);
    drag = { n, offset: hit ? n.pos.clone().sub(hit) : new THREE.Vector3() };
    setHover(n);
  }
  addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!rayAt(ev)) return;
    drag.n.pos.copy(hitPoint).add(drag.offset);
    for (const e of incident.get(drag.n)) redrawLink(e);
    placeGroups();
    invalidate();
  });
  addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    controls.enabled = true;
    saveDraft();
  });

  const editor = document.getElementById('editor');
  const editorText = editor.querySelector('textarea');
  const snapshot = () => Object.fromEntries(model.nodes.map((n) =>
    [n.name, n.pos.toArray().map((v) => Math.round(v * 10) / 10)]));
  function showEditor() {
    editor.hidden = false;
    editorText.value = JSON.stringify(snapshot(), null, 0).replace(/\],"/g, '],\n"');
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch { /* private mode */ }
    showEditor();
  }
  editor.querySelector('.ed-copy').addEventListener('click', async () => {
    editorText.select();
    try { await navigator.clipboard.writeText(editorText.value); } catch { document.execCommand('copy'); }
    editor.querySelector('.ed-copy').textContent = 'copied';
    setTimeout(() => { editor.querySelector('.ed-copy').textContent = 'copy'; }, 1200);
  });
  editor.querySelector('.ed-discard').addEventListener('click', () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    location.reload();
  });
  if (draft) showEditor();
  el.addEventListener('pointerdown', (ev) => {
    flight = null;
    if (ev.altKey) { const n = pick(ev); if (n) { startDrag(n, ev); return; } }
    down = { x: ev.clientX, y: ev.clientY };
  });
  el.addEventListener('pointerup', (ev) => {
    if (drag) return;
    const click = down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5;
    down = null;
    if (!click) return;
    const n = pick(ev);
    if (n) select(n); else if (selected) deselect(false);
  });
  el.addEventListener('pointerleave', () => { pendingMove = null; setHover(null); });

  let W = innerWidth, H = innerHeight;
  addEventListener('resize', () => {
    W = innerWidth; H = innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
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

    for (const n of model.nodes) {
      const label = labelFor.get(n);
      up.set(0, n.size * 0.62 * n.obj.scale.x + 0.35, 0).add(n.obj.position);
      if (!place(label, up)) continue;
      const dist = camera.position.distanceTo(n.obj.position);
      label.style.zIndex = String(1000 - Math.round(dist));
    }
    for (const g of groups) place(g.el, g.top);
    renderer.render(scene, camera);
  }

  placeGroups();
  refreshFocus();
  requestAnimationFrame(frame);
  const fromHash = model.nodes.find((n) => `#${n.id}` === location.hash);
  if (fromHash) select(fromHash);
}
