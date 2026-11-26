// Visualisation layer only. All project data comes from the source
// (the command dashboard export); nothing here adds or edits projects.
//
//   ?src=<url>      read projects from another URL (default: data/projects.json)
//   ?base=<url>     prefix for project urls that start with "/" (e.g. /basex)
//   ?view=3d|list   force a mode

const params = new URLSearchParams(location.search);
const SOURCE = params.get('src') || 'data/projects.json';
const RELATIVE_BASE = params.get('base') || '';

export const slug = (s) => s.toLowerCase()
  .replace(/\(.*?\)/g, '').replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const shortName = (s) => s.replace(/\s*\(.*\)/, '');
export const statusLabel = (s) => (s || '').replace(/-/g, ' ');

// Turn the source JSON into nodes + links. Order in the source array = priority.
function buildModel({ hq, projects }) {
  const nodes = projects.map((p, i) => ({
    ...p,
    id: slug(p.name),
    rank: i,
    href: !p.url ? null : p.url.startsWith('/') ? RELATIVE_BASE + p.url : p.url,
    isCore: p.name === hq,
    tags: [...new Set((p.tags || []).map((t) => t.toLowerCase()))],
  }));
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const core = nodes.find((n) => n.isCore) || nodes[0];
  core.isCore = true;

  const links = [];
  const seen = new Set();
  const add = (A, B, kind) => {
    if (!A || !B || A === B) return;
    const key = [A.id, B.id].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ a: A, b: B, kind });
  };
  for (const n of nodes) for (const t of n.connects_to || []) add(n, byName.get(t), 'stated');
  // A project with no stated connection is tied to the hub of its cluster
  // (the member with the most connections), or to the core if it has no cluster.
  const degree = (n) => links.filter((l) => l.a === n || l.b === n).length;
  const hubOf = new Map();
  for (const n of nodes) {
    if (!n.cluster) continue;
    const h = hubOf.get(n.cluster);
    if (!h || degree(n) > degree(h)) hubOf.set(n.cluster, n);
  }
  for (const n of nodes) {
    if (n.isCore || degree(n)) continue;
    const hub = (n.cluster && hubOf.get(n.cluster)) || core;
    add(hub === n ? core : hub, n, 'root');
  }

  return { core, nodes, links };
}

export const neighbours = (model, n) => model.links
  .filter((l) => l.kind === 'stated' && (l.a === n || l.b === n))
  .map((l) => (l.a === n ? l.b : l.a))
  .sort((x, y) => x.rank - y.rank);

/* ---------- mobile / fallback list ---------- */
function renderList(model) {
  document.getElementById('list').hidden = false;
  const nav = document.getElementById('m-nav');
  const cards = document.getElementById('m-cards');
  for (const n of model.nodes) {
    const a = document.createElement('a');
    a.href = `#${n.id}`;
    a.textContent = shortName(n.name);
    a.dataset.id = n.id;
    nav.append(a);

    const card = document.createElement('article');
    card.className = 'm-card' + (n.isCore ? ' core' : '');
    card.id = n.id;
    card.innerHTML = `<h2><i class="st-dot st-${n.status}" title=""></i><span></span></h2><p class="m-tagline"></p><a class="m-visit" target="_blank" rel="noopener">Enter ↗</a>`;
    card.querySelector('h2 span').textContent = n.name;
    card.querySelector('.st-dot').title = statusLabel(n.status);
    card.querySelector('.m-tagline').textContent = n.tagline || '';
    if (n.href) card.querySelector('.m-visit').href = n.href;
    else card.querySelector('.m-visit').remove();
    cards.append(card);
  }
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

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

async function boot() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
  const model = buildModel(await res.json());
  const forced = params.get('view');
  const want3D = forced === '3d' || (forced !== 'list' && !matchMedia('(max-width: 820px)').matches);
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
    '<p style="color:#7f7;padding:2rem;font-family:monospace">Could not load project data. Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>).</p>');
});
