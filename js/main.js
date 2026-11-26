// Entry point: loads data, decides between the 3D map (desktop) and the
// scrolling list (mobile / no WebGL), and wires up the shared bits.

const STATUS_LABEL = {
  'active': 'active',
  'awaiting-deployment': 'awaiting deployment',
  'done': 'done',
  'for-sale': 'for sale',
};

export const slug = (s) => s.toLowerCase()
  .replace(/\(.*?\)/g, '')
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

export const statusLabel = (s) => STATUS_LABEL[s] || s;

async function loadModel() {
  const [projRes, layoutRes] = await Promise.all([
    fetch('data/projects.json'), fetch('data/layout.json'),
  ]);
  const { hq, projects } = await projRes.json();
  const layout = await layoutRes.json();

  const byName = new Map(projects.map((p) => [p.name, p]));
  const order = [...layout.priority.filter((n) => byName.has(n)),
    ...projects.map((p) => p.name).filter((n) => !layout.priority.includes(n))];

  const clusterOf = new Map();
  for (const c of layout.clusters) for (const m of c.members) clusterOf.set(m, c.id);

  const nodes = order.map((name, i) => {
    const p = byName.get(name);
    const url = p.url.startsWith('/') ? (layout.relative_base || '') + p.url : p.url;
    return {
      ...p,
      id: slug(name),
      rank: i,
      num: String(i + 1).padStart(2, '0'),
      href: url,
      isHQ: name === hq,
      cluster: clusterOf.get(name) || layout.clusters[0].id,
      tags: [...new Set(p.tags.map((t) => t.toLowerCase()))],
    };
  });
  const nodeByName = new Map(nodes.map((n) => [n.name, n]));

  // Links: stated (connects_to) and inferred (layout.json). Deduplicated, undirected.
  const links = [];
  const seen = new Set();
  const add = (a, b, kind, why) => {
    const A = nodeByName.get(a), B = nodeByName.get(b);
    if (!A || !B || A === B) return;
    const key = [A.id, B.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ a: A, b: B, kind, why });
  };
  for (const n of nodes) for (const t of n.connects_to) add(n.name, t, 'stated');
  for (const l of layout.inferred_links) add(l.from, l.to, 'inferred', l.why);

  const hqNode = nodes.find((n) => n.isHQ);
  return { hq: hqNode, nodes, links, clusters: layout.clusters };
}

export function connectionsOf(model, node) {
  return model.links
    .filter((l) => l.a === node || l.b === node)
    .map((l) => ({ other: l.a === node ? l.b : l.a, kind: l.kind, why: l.why }))
    .sort((x, y) => (x.kind === y.kind ? x.other.rank - y.other.rank : x.kind === 'stated' ? -1 : 1));
}

/* ---------------- matrix rain on the screen edges ---------------- */
function startRain() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('rain');
  const ctx = c.getContext('2d');
  const glyphs = 'アカサタナハマヤラワ0123456789ΣΔΩΨ∞◇△▽PCBXNS'.split('');
  const size = 14;
  let cols = [], w = 0, h = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    w = innerWidth; h = innerHeight;
    c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Array.from({ length: Math.ceil(w / size) }, () => Math.random() * -h / size);
  };
  resize(); addEventListener('resize', resize);
  let last = 0;
  const tick = (t) => {
    requestAnimationFrame(tick);
    if (t - last < 70 || document.hidden) return;
    last = t;
    ctx.fillStyle = 'rgba(2, 8, 5, 0.16)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${size - 2}px "Share Tech Mono", monospace`;
    for (let i = 0; i < cols.length; i++) {
      const y = cols[i] * size;
      ctx.fillStyle = Math.random() < 0.04 ? '#d9ffe6' : '#1fbf62';
      ctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], i * size, y);
      cols[i] = y > h && Math.random() > 0.975 ? 0 : cols[i] + 1;
    }
  };
  requestAnimationFrame(tick);
}

/* ---------------- mobile / fallback list ---------------- */
function renderList(model) {
  const root = document.getElementById('list');
  root.hidden = false;
  document.getElementById('rain').style.opacity = '.25';
  const clusterLabel = Object.fromEntries(model.clusters.map((c) => [c.id, c.label]));
  const nav = document.getElementById('m-nav');
  const cards = document.getElementById('m-cards');

  for (const n of model.nodes) {
    const a = document.createElement('a');
    a.href = `#${n.id}`;
    a.textContent = `${n.num} ${n.name.replace(/\s*\(.*\)/, '')}`;
    a.dataset.id = n.id;
    nav.append(a);

    const conns = connectionsOf(model, n);
    const card = document.createElement('article');
    card.className = 'm-card' + (n.isHQ ? ' hq' : '');
    card.id = n.id;
    card.innerHTML = `
      <div class="m-top"><span class="m-num">${n.num}</span><span class="m-status st-${n.status}">${statusLabel(n.status)}</span></div>
      <h2></h2>
      <div class="m-cluster">${n.isHQ ? 'HQ' : clusterLabel[n.cluster] || ''}</div>
      <p class="m-tagline"></p>
      <p class="m-about"></p>
      ${n.tags.length ? `<div class="m-tags">${n.tags.map((t) => `<span>#${t}</span>`).join('')}</div>` : ''}
      ${conns.length ? `<p class="m-links">Connects to: ${conns.map((c) => `<a href="#${c.other.id}">${escapeHtml(c.other.name)}</a>${c.kind === 'inferred' ? '*' : ''}`).join(', ')}</p>` : ''}
      <a class="m-visit" target="_blank" rel="noopener">Open ↗</a>`;
    card.querySelector('h2').textContent = n.name;
    card.querySelector('.m-tagline').textContent = n.tagline;
    card.querySelector('.m-about').textContent = n.about;
    card.querySelector('.m-visit').href = n.href;
    cards.append(card);
  }

  // Scroll-spy: highlight the chip of the card in view, and keep it visible in the strip.
  const chips = new Map([...nav.children].map((a) => [a.dataset.id, a]));
  let current = null;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const chip = chips.get(e.target.id);
      if (chip === current) continue;
      current?.classList.remove('on');
      chip.classList.add('on');
      current = chip;
      nav.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  cards.querySelectorAll('.m-card').forEach((c) => io.observe(c));
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

async function boot() {
  const model = await loadModel();
  const params = new URLSearchParams(location.search);
  const forced = params.get('view');
  const smallScreen = matchMedia('(max-width: 820px)').matches;
  const want3D = forced === '3d' || (forced !== 'list' && !smallScreen);

  startRain();

  if (want3D && hasWebGL()) {
    try {
      const { startScene } = await import('./scene.js');
      startScene(model);
      return;
    } catch (err) {
      console.error('3D failed, falling back to list', err);
      document.getElementById('stage').hidden = true;
    }
  }
  renderList(model);
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    '<p style="color:#7f7;padding:2rem;font-family:monospace">Could not load project data. If you opened this file directly, serve the folder over HTTP (e.g. <code>python3 -m http.server</code>).</p>');
});
