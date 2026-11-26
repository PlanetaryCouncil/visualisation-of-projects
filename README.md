# Projects Multiverse

A visualisation layer for the projects tracked on the command dashboard. It holds **no data of its own**: it reads one JSON file and draws it. Static site, no build step.

- **Desktop:** one interconnected 3D network. Planetary Council (global governance) sits at the centre as a heart inside a cube. Stated connections are lines with agents travelling along them. Projects sharing tags drift together, and each tag group is a faint shell; the shells overlap because projects belong to several. Names appear on hover or when you fly close. Click a cube to open it; `←`/`→` step through, `Esc` resets.
- **Mobile (≤ 820px) or no WebGL:** a list in source order with a sticky jump strip.

## Data

`data/projects.json` is a snapshot of the dashboard's data. See [SCHEMA.md](SCHEMA.md) for the fields the map reads. To read live data instead, pass `?src=<url>`. Project urls starting with `/` are prefixed with `?base=<url>`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `?view=list` or `?view=3d` to force a mode.
