# Projects Multiverse

A visualisation layer for the projects tracked on the command dashboard. It holds **no data of its own**: it reads one JSON file and draws it. Static site, no build step.

- **Desktop:** one interconnected 3D network. Planetary Council (global governance) sits at the centre as a heart inside a cube. Stated connections are lines. Each `cluster` is a faint shell. Names appear on hover or when you fly close. There is no idle animation: the page draws a frame only when you move, hover or click, so it costs nothing while you read. Click a cube to open it; `←`/`→` step through, `Esc` resets.
- **Mobile (≤ 820px) or no WebGL:** a list in source order with a sticky jump strip.

## Data

`data/projects.json` is a snapshot of the dashboard's data. See [SCHEMA.md](SCHEMA.md) for the fields the map reads. To read live data instead, pass `?src=<url>`. Project urls starting with `/` are prefixed with `?base=<url>`.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Add `?view=list` or `?view=3d` to force a mode.

## Live site

https://planetarycouncil.github.io/visualisation-of-projects/ — GitHub Pages deploys
the `claude/happy-babbage-vokr7d` branch on every push. Phones get the list; wider
screens get the 3D map.

## Arranging the 3D map

Hold **Alt** (Option on a Mac) and drag a project. It moves in the plane facing you;
orbit the view to move it in depth. A box appears at the bottom with every position.
Your moves are kept in this browser until you press **discard**. To make them the
default for everyone, press **copy** and paste the result into `data/positions.json`
(or hand it to Claude). Projects missing from that file are placed automatically.
