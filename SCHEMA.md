# Data contract

The map reads one JSON document. The dashboard is the source of truth; this repo only draws it.

```json
{
  "hq": "Planetary Council",
  "projects": [
    {
      "name": "BaseX",
      "tagline": "A new definition of value — triple bottom line",
      "url": "/basex",
      "status": "active",
      "cluster": "governance",
      "tags": ["governance", "climate"],
      "part_of": ["Planetary Council"],
      "connects_to": ["Independent Tribunal"]
    }
  ]
}
```

| Field | Required | How the map uses it |
| --- | --- | --- |
| `hq` | yes | Name of the project drawn at the centre (the heart). |
| `projects[]` order | yes | Priority. First = most important: bigger cube, top of the mobile list. |
| `name` | yes | Label, and the key that `part_of` / `connects_to` refer to. Must be unique. |
| `tagline` | yes | The one line shown when a project is opened. |
| `url` | no | The "Enter" button (hidden when empty). A leading `/` is prefixed with `?base=`. |
| `status` | yes | Shown as text in the panel. All projects are drawn in one colour. |
| `cluster` | no | Projects with the same cluster are pulled together when auto-placed. Not drawn. Current clusters: `governance`, `art`, `mars`. |
| `tags` | no | Shared tags pull projects slightly together. |
| `part_of` | no | Parent projects ("this is part of that"). Drawn as a solid, thicker line. |
| `connects_to` | no | Siblings. Drawn as a dashed line, either direction. Not every sibling needs one. A pair with both a parent and a sibling link shows the parent line. |
| `about` | no | Longer description (AI-polished). Not displayed. |
| `mars_wrote` | no | Mars’s own words, kept verbatim and never rewritten. Not displayed. |

A new project needs nothing more than an entry in `projects`; the layout places it automatically.

## Layout (this repo's own file)

`data/layout.json` holds only how the map looks, not project data: each project's 3D position and size (size 1 = default; bigger means a bigger cube and thicker border). Projects missing from it are auto-placed.

```json
{ "Planetary Council": { "pos": [0, 0, 0], "size": 1.5 } }
```

The in-page editor (press `E`) exports `layout`, `part_of` and `connects_to` together. `layout` goes into `data/layout.json`; `part_of` and `connects_to` go into the project data (and the dashboard).
