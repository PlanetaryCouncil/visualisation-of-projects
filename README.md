# Projects Multiverse

A visualisation layer for the projects tracked on the command dashboard. It holds **no data of its own**: it reads one JSON file and draws it. Static site, no build step.

- **Desktop:** one interconnected 3D network. Planetary Council (global governance) sits at the centre. Projects are cubes; standalone, self-sufficient ones are triangular pyramids. A single line is parent → child (`part_of`), a double line is siblings (`connects_to`). Every name is always shown; size is set by hand to shape attention. There is no idle animation: the page draws a frame only when you move, hover or click, so it costs nothing while you read. Click a cube to open it; `←`/`→` step through, `Esc` resets.
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

- **Alt + drag** a project (Option on a Mac): move it in the plane facing you; orbit to move it in depth.
- **Alt + scroll** over a project: bigger / smaller (the border thickens with it).
- **E** opens the editor. There, without Alt: drag to move, scroll to resize, or pick a line tool —
  **parent → child** (drag from parent to child, single line), **sibling** (double line), or **cube / pyramid** (click a project to mark it standalone). To remove a line, click it (it turns white) and press Backspace.

Changes stay in your browser until **discard**. To make them the default for everyone, **copy** the box
and paste it to Claude (or apply it yourself: see the end of [SCHEMA.md](SCHEMA.md)).
