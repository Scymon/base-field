# Fields

An Obsidian plugin for creating visual fields: a Diablo-style top-down board where notes and custom pieces sit on a tilted ground plane. Optional map image. Shared renderer for standalone `.field` files and a custom Bases layout.

Requires **Obsidian 1.10.2+** so the public Bases view API (including file view options) is available.

## Install

This plugin is not in the community catalog yet.

### BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Add `https://github.com/Scymon/base-field` as a beta plugin.
3. Enable **Fields** under **Settings → Community plugins**.

### Manual

1. Create `<Vault>/.obsidian/plugins/base-field/`.
2. Copy `main.js`, `manifest.json`, and `styles.css` from a [release](https://github.com/Scymon/base-field/releases) into that folder.
3. Reload Obsidian and enable **Fields**.

### From source

```bash
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/base-field/`. For local development you can instead clone this repo directly into that folder and run `npm run dev`.

## Two entry points

Both use the same Three.js board renderer.

### `.field` files

Standalone boards, similar to `.canvas` files.

- Command palette: **Fields: Create new field**, or the map ribbon icon.
- Drag a note from the file explorer (or a `[[wiki link]]` / markdown link) onto the board to place it under the cursor. The drop uses the same `app.dragManager` + `text/plain` / `text/uri-list` path Canvas does, and stops the workspace from opening the file instead.
- The **Components** side pane is a palette of piece types. Drag one onto the board to instance it. **Add** creates a new named component.
- The JSON stores camera, optional `groundImage` vault path, `groundSize`, `components`, and `instances`.
- The board is a Matrix-style white construct: thin dark grid lines on an open white field, receding toward the horizon. There is no solid ground plate. Use the toolbar size button (or `groundSize` in the file) to change how far you can pan — Size is the play area, not how large the visible grid is.
- Instances can be **notes** (`kind: "note"`, `path`) or **custom pieces** (`kind: "piece"`, `label`).
- Either kind may set `model` to a vault path.

Example:

```json
{
	"version": 1,
	"camera": {
		"mode": "perspective",
		"target": [0, 0],
		"distance": 40,
		"azimuth": 0.55,
		"elevation": 0.95
	},
	"groundImage": "maps/overworld.png",
	"groundSize": 480,
	"instances": [
		{ "id": "n1", "kind": "note", "path": "People/Ava.md", "x": -2, "y": 1 },
		{ "id": "p1", "kind": "piece", "label": "Camp", "x": 3, "y": -1, "model": "models/tent.glb" }
	]
}
```

### Bases layout

If Bases is enabled, **Fields** appears in the same layout menu as Table, Cards, and List.

The base query is the roster. Matching notes appear in the **Base filter** side pane; drag one onto the board to place it (writes `x` / `y`). Notes that already have coordinates stay on the field. File-explorer drops are not used in this mode.

View options:

| Option | Purpose |
| --- | --- |
| Ground image | Optional vault image used as the map |
| Camera | Perspective or orthographic |
| Field size | How far the board extends. Default is large; shrink it if you want a smaller plane |
| X position / Y position | Note properties that store board coordinates (default `x` and `y`) |
| Model file | Optional note property pointing at a glTF/GLB/OBJ file |

Notes without X/Y yet are placed on a grid until you drag them.

## Controls

- **Drag a pawn** to move it. Position is saved (`.field` JSON, or note properties in a Base).
- **Click a note-pawn** to open that note. Hover preview uses the Page Preview plugin.
- **Drag empty ground** to pan (the grabbed point stays under the cursor). **Right-drag** (or Alt-drag) to orbit. **Scroll** to zoom.
- The camera stays locked to a board angle. It is not a free-fly camera.

## Models

Runtime formats only: **glTF, GLB, or OBJ**. Do not point Fields at `.blend` files — Obsidian cannot run Blender files. If no model is set, or the file is not a runtime format, the default pawn is used.

Prefer **GLB** (embedded textures). A `.gltf` with sidecar bins/textures will load if those files sit next to it in the vault.

## Mobile

`isDesktopOnly` is false. The board uses WebGL, so a device needs a working WebGL context. Touch: one finger pans or drags a pawn; pinch-zoom is not implemented in v0 — use a scroll gesture if the platform provides one. Desktop is the primary target.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # typecheck + production bundle
```

The board is an open white field with a thin dark grid that recedes over a long fade — no scene fog and no filled ground disc. Size only limits how far you can pan. Existing `.field` files without `groundSize` open at the large default.
