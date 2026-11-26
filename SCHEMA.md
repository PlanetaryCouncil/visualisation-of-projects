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
      "status": "awaiting-deployment",
      "tags": ["governance", "climate"],
      "connects_to": ["Planetary Council"]
    }
  ]
}
```

| Field | Required | How the map uses it |
| --- | --- | --- |
| `hq` | yes | Name of the project drawn at the centre (the heart). |
| `projects[]` order | yes | Priority. First = most important: bigger cube, top of the mobile list. |
| `name` | yes | Label, and the key that `connects_to` refers to. Must be unique. |
| `tagline` | yes | The one line shown when a project is opened. |
| `url` | yes | The "Enter" button. A leading `/` is prefixed with `?base=`. |
| `status` | yes | Colour: `active` green, `awaiting-deployment` amber, `done` cyan, `for-sale` pink. Unknown values draw green. |
| `tags` | no | Shared tags pull projects together; a tag on 3+ projects becomes a shell. |
| `connects_to` | no | Drawn as lines, in either direction. A project with none gets a faint line to the `hq` so nothing floats loose. |
| `about`, `said` | no | Not displayed. |

A new project needs nothing more than an entry in `projects`; the layout places it automatically.
