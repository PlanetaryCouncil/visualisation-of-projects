# Projects Multiverse

An interactive 3D map of the projects orbiting **Planetary Council**. Static site, no build step.

- **Desktop:** a holonic 3D space. Each project is a cube with a smaller cube inside it; rooms sit inside cluster shells (Person, Institutions, Culture & Memes, Value & Futures, AI Agents, Gallery, Land, Emerging); the HQ heart sits in the middle with a branch to each cluster. Only cluster names show by default; room names appear on hover or when you fly close. The Emerging cluster holds empty rooms (set by `emerging` in `data/layout.json`) for autonomous projects that do not exist yet. Lights travelling along the links are agents wandering the network. Drag to orbit, scroll to zoom, click a cube (or a name on the left) to open it. `←`/`→` step through by priority, `Esc` resets.
- **Mobile (≤ 820px wide) or no WebGL:** a single scrolling list in priority order, with a sticky strip of chips to jump between projects.
- Force a mode with `?view=3d` or `?view=list`. Deep-link a project with `#basex`, `#independent-tribunal`, etc.

## Editing

| File | What it controls |
| --- | --- |
| `data/projects.json` | What each project is (name, tagline, about, url, status, tags, stated `connects_to`). Source of truth. |
| `data/layout.json` | Priority order, cluster membership and placement, `inferred_links` (the "obvious" connections, each with a reason; drawn dashed), and `relative_base` for urls like `/basex`. |

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` straight from disk won't work, because the page fetches the JSON files.

Three.js 0.160 loads from jsDelivr; nothing to install.
