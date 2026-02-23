# Brick Builder MCP App — Full Specification

## Context

We're building a Three.js MCP App that lets users design 3D brick constructions (inspired by interlocking brick systems, but never using the term "LEGO"). The app runs inside MCP-enabled hosts like Claude Desktop, combining an interactive 3D builder UI with a set of MCP tools that let both the AI and the user manipulate the scene.

**Why an MCP App?** This gives the AI direct access to the brick scene — it can build structures, query what the user has built, and collaborate on designs through tool calls, while the user interacts via the 3D viewport.

**Reference implementations studied:**
- `github.com/nicmosc/brick-builder` — React + Three.js brick builder with paint mode, import/export
- `lego.softcom.ge` — React 19 + Three.js brick builder with AI integration
- MCP Apps SDK `threejs-server` example — patterns for Three.js in MCP Apps
- MCP Apps SDK `wiki-explorer-server` — `callServerTool` pattern for interactive data fetching

---

## Architecture Overview

**Two-layer architecture:**

```
┌─────────────────────────────────────────┐
│  MCP Host (Claude Desktop)              │
│  ┌───────────────────────────────────┐  │
│  │  Client (React + Three.js)        │  │
│  │  Bundled as single HTML file      │  │
│  │  Communicates via callServerTool  │  │
│  └──────────────┬────────────────────┘  │
│                 │ postMessage             │
│  ┌──────────────┴────────────────────┐  │
│  │  Server (Express + MCP SDK)       │  │
│  │  Per-session scene state          │  │
│  │  14 MCP tools                     │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**Server = source of truth.** Both the LLM and the UI mutate state through server tools. The server validates all operations (collision detection, type validation) and returns the updated scene. The client reconciles its Three.js scene graph against the server response.

**Data flow — user places a brick:**
```
Click → raycast grid position → app.callServerTool('brick_add', {...})
→ Server validates & adds → returns ScenePayload
→ ontoolresult fires → setSceneData() → SceneReconciler updates Three.js
```

**Data flow — LLM builds a structure:**
```
LLM calls brick_build_structure → Server adds bricks → returns ScenePayload
→ ontoolresult fires → setSceneData() → SceneReconciler updates Three.js
```

---

## File Structure

```
brick-mcp-app/
├── package.json
├── tsconfig.json                    # Client typecheck (noEmit, jsx, DOM libs)
├── tsconfig.server.json             # Server declarations (NodeNext)
├── vite.config.ts                   # Vite + react + singlefile plugin
├── main.ts                          # HTTP/stdio entry point
├── server.ts                        # createServer() factory, all tools, scene logic
├── mcp-app.html                     # Vite entry HTML
├── src/
│   ├── vite-env.d.ts
│   ├── global.css
│   ├── mcp-app.tsx                  # React mount, MCP App lifecycle
│   ├── types.ts                     # Shared types (BrickInstance, SceneData, etc.)
│   ├── constants.ts                 # Dimensions, colors, modes
│   ├── engine/
│   │   ├── BrickCatalog.ts          # Brick type definitions
│   │   ├── SceneReconciler.ts       # Diffs server state → Three.js scene
│   │   └── CollisionDetector.ts     # Client-side AABB for ghost preview
│   ├── three/
│   │   ├── SceneManager.ts          # Renderer, camera, controls, lighting
│   │   ├── BrickGeometry.ts         # Parametric geometry + stud generation + cache
│   │   ├── BrickMesh.ts             # BrickInstance → Three.js mesh
│   │   ├── GhostPreview.ts          # Semi-transparent placement preview
│   │   ├── GridHelper.ts            # Baseplate + grid lines + raycast plane
│   │   └── RaycastHelper.ts         # Placement & selection raycasting
│   ├── hooks/
│   │   ├── useSceneManager.ts       # Three.js lifecycle in React
│   │   └── useInteraction.ts        # Mouse/keyboard per mode
│   └── components/
│       ├── BrickBuilder.tsx          # Main layout (canvas + overlays)
│       ├── ThreeCanvas.tsx           # Container div for renderer
│       ├── Toolbar.tsx               # Mode buttons (Place, Select, etc.)
│       ├── BrickSelector.tsx         # Brick type catalog panel
│       ├── ColorPicker.tsx           # Color swatch row
│       └── SceneInfo.tsx             # Scene name, count, export
```

---

## Shared Types (`src/types.ts`)

```typescript
export interface BrickType {
  id: string;              // e.g. "brick_2x4"
  name: string;            // "2×4 Brick"
  category: 'brick' | 'plate' | 'slope';
  studsX: number;          // Width in studs
  studsZ: number;          // Depth in studs
  heightUnits: number;     // Height in plate units (brick=3, plate=1)
}

export interface BrickInstance {
  id: string;              // UUID from server
  typeId: string;          // References BrickType.id
  position: { x: number; y: number; z: number };  // Grid coords (stud X/Z, plate-height Y)
  rotation: 0 | 90 | 180 | 270;                    // Degrees around Y axis
  color: string;                                     // Hex, e.g. "#cc0000"
}

export interface CameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface SceneData {
  name: string;
  bricks: BrickInstance[];
  camera?: CameraState;
}

export interface ScenePayload {
  scene: SceneData;
  message?: string;
}

export interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}
```

---

## Constants & Dimensions (`src/constants.ts`)

All spatial dimensions use "stud units" where 1 stud = 1 Three.js world unit.

| Constant | Value | Meaning |
|----------|-------|---------|
| `STUD_SIZE` | 1.0 | 1 stud = 1 world unit |
| `STUD_DIAMETER` | 0.6 | Stud cylinder diameter |
| `STUD_HEIGHT` | 0.2 | Stud cylinder height |
| `PLATE_HEIGHT` | 0.4 | 1 plate = 0.4 world units |
| `BRICK_HEIGHT` | 1.2 | 1 brick = 3 plates |
| `BRICK_GAP` | 0.025 | Tolerance gap between bricks |
| `BASEPLATE_SIZE` | 32 | 32×32 stud grid |

**Y-axis uses plate-height integers:** A standard brick at Y=0 occupies Y layers [0, 3). Stacking a plate on it → Y=3, occupies [3, 4). Stacking another brick → Y=4, occupies [4, 7). All position math stays in integers.

**16 default colors:** Red, Blue, Green, Yellow, White, Black, Orange, Magenta, Brown, Dark Gray, Light Gray, Tan, Teal, Pink, Lime, Peach.

**6 interaction modes:** `place`, `select`, `move`, `rotate`, `delete`, `paint`.

---

## Brick Catalog (`src/engine/BrickCatalog.ts`)

20 brick types across 3 categories:

**Bricks** (heightUnits=3): 1×1, 1×2, 1×3, 1×4, 1×6, 1×8, 2×2, 2×3, 2×4, 2×6, 2×8
**Plates** (heightUnits=1): 1×1, 1×2, 1×4, 2×2, 2×4, 2×6, 4×4
**Slopes** (heightUnits=3): 1×2, 2×2, 2×3

---

## MCP Tools (14 Total)

All tools share one `resourceUri: "ui://brick-builder/mcp-app.html"`. Per-session scene state lives inside the `createServer()` closure.

### Model-visible tools (LLM calls these)

| # | Tool | Purpose | Key Args |
|---|------|---------|----------|
| 1 | `brick_render_scene` | Opens the UI, shows current scene | (none) |
| 2 | `brick_build_structure` | Batch-add bricks in one call | `bricks[]`, `clearFirst?` |
| 3 | `brick_get_scene` | Read scene state (to "see" what user built) | (none) |
| 4 | `brick_export_scene` | Export as JSON or human summary | `format: "json" \| "summary"` |

### Both model + app visible tools

| # | Tool | Purpose | Key Args |
|---|------|---------|----------|
| 5 | `brick_add` | Add one brick | `typeId, x, y, z, rotation?, color?` |
| 6 | `brick_remove` | Remove brick by ID | `brickId` |
| 7 | `brick_move` | Move brick to new position | `brickId, x, y, z` |
| 8 | `brick_rotate` | Set brick rotation | `brickId, rotation` |
| 9 | `brick_paint` | Change brick color | `brickId, color` |
| 10 | `brick_clear_scene` | Remove all bricks | (none) |
| 11 | `brick_set_camera` | Set camera position/target | `posX/Y/Z, targetX/Y/Z` |
| 12 | `brick_import_scene` | Import scene JSON | `sceneJson` |
| 13 | `brick_set_scene_name` | Set scene name | `name` |

### App-only tools (UI calls via callServerTool)

| # | Tool | Purpose | Key Args |
|---|------|---------|----------|
| 14 | `brick_get_catalog` | Fetch brick type catalog for UI | (none) |

### Tool behavior details

- **Collision detection** on `brick_add`, `brick_move`, `brick_rotate`, `brick_build_structure`: AABB overlap check. Returns `isError: true` with message on collision. `brick_build_structure` skips colliding bricks rather than failing the whole batch.
- **All scene-mutating tools** return `ScenePayload` (the full scene + message). The client parses this in `ontoolresult` and reconciles the Three.js scene.
- **`brick_build_structure`** is the LLM's power tool — it places many bricks in one call (e.g., "build a 4×4 red wall 6 bricks high").
- **`brick_export_scene` with format "summary"** returns human-readable text: "Scene 'My House': 42 bricks. Dimensions: 8×6×12 studs. Colors: 20 red, 15 blue, 7 white."

---

## Server Implementation (`server.ts`)

Based directly on the MCP Apps SDK `threejs-server` example pattern:

```
createServer() → McpServer with:
  - Per-session: let scene: SceneData = { name: 'Untitled', bricks: [] }
  - Collision helpers: getBrickAABB(), aabbOverlap(), checkCollision()
  - 14 registerAppTool() calls
  - 1 registerAppResource() call (serves dist/mcp-app.html)
```

AABB collision uses the integer grid coordinates directly — `position.x + studsX` for X range, `position.y + heightUnits` for Y range. Rotation swaps studsX/studsZ for 90°/270°.

## Entry Point (`main.ts`)

Identical to the `threejs-server/main.ts` — Express + `createMcpExpressApp` + `StreamableHTTPServerTransport` for HTTP mode, `StdioServerTransport` for `--stdio` mode. Port defaults to 3001.

---

## Client Architecture

### MCP App Lifecycle (`src/mcp-app.tsx`)

- `useApp` hook creates the MCP App and connects via PostMessageTransport
- `ontoolresult` handler: parse `ScenePayload` from result → `setSceneData()`
- On mount: request fullscreen display mode, call `brick_get_catalog`
- `onhostcontextchanged`: track host theme/styles

### Three.js Scene (`src/three/SceneManager.ts`)

- `PerspectiveCamera` (FOV 50), positioned at (25, 20, 25)
- `OrbitControls` with damping, max polar angle to prevent flipping under
- Lighting: ambient + directional (with shadow map 2048×2048) + hemisphere
- `WebGLRenderer` with antialias, shadow maps, pixel ratio clamped to 2
- `ResizeObserver` for responsive canvas

### Baseplate (`src/three/GridHelper.ts`)

- Green `BoxGeometry` for the baseplate surface
- `THREE.GridHelper` with 32×32 stud lines (semi-transparent)
- Invisible `PlaneGeometry` at Y=0 for raycast placement on ground

### Brick Geometry (`src/three/BrickGeometry.ts`)

Parametric generation with cache per `BrickType.id`:
- **Bricks & plates:** `BoxGeometry` body (with gap tolerance) + `CylinderGeometry` studs on top, merged via `mergeGeometries`
- **Slopes:** `ExtrudeGeometry` from a triangular `Shape` + studs on the back row only
- Cache prevents redundant computation — geometry is shared across instances

### Scene Reconciler (`src/engine/SceneReconciler.ts`)

Diff-based sync between `SceneData.bricks[]` and Three.js scene graph:
1. Remove meshes for bricks no longer in server state
2. Add meshes for new bricks
3. Update position/rotation/color for changed bricks
4. Maintains `meshMap: Map<brickId, Object3D>` for O(1) lookups
5. Returns `getBrickMeshes()` array for raycasting

### Interaction System (`src/hooks/useInteraction.ts`)

Mouse/keyboard handling dispatched by current mode:

| Mode | Pointer Move | Click / Drag |
|------|-------------|--------------|
| `place` | Update ghost preview (green=valid, red=collision) | Click → `callServerTool('brick_add', ...)` |
| `select` | — | Click → Raycast → `onSelect(brickId)` |
| `move` | If dragging: ghost preview follows cursor at new grid pos | Mousedown on brick starts drag, mousemove updates ghost, mouseup → `callServerTool('brick_move', ...)` |
| `rotate` | — | Click → Raycast → `callServerTool('brick_rotate', ...)` with next 90° |
| `delete` | — | Click → Raycast → `callServerTool('brick_remove', ...)` |
| `paint` | — | Click → Raycast → `callServerTool('brick_paint', ...)` |

**Drag-to-move implementation:**
1. `pointerdown` on a brick: set `dragState = { brickId, originalPos }`, temporarily hide the original brick mesh, disable OrbitControls
2. `pointermove` while dragging: raycast for new grid position, show ghost preview (green/red for collision), use `setPointerCapture` to keep receiving events even if pointer leaves canvas
3. `pointerup`: if valid position → `callServerTool('brick_move', ...)`. If collision/invalid → snap back to original. Re-enable OrbitControls, clear drag state.
4. `Escape` during drag → cancel, restore original position

**Ghost preview:** Semi-transparent brick following cursor, snapped to grid. Green when placement is valid, red on collision. Client-side AABB check for instant feedback (server still validates authoritatively).

**Keyboard shortcuts:** R = cycle rotation, Delete = remove selected, Escape = deselect, 1-6 = switch modes.

### UI Components

- **Toolbar** (left): Vertical strip of mode buttons with keyboard shortcuts
- **BrickSelector** (right): Scrollable panel of brick types grouped by category (visible in place mode)
- **ColorPicker** (bottom): Horizontal color swatch row (visible in place/paint modes)
- **SceneInfo** (top-right): Scene name input, brick count, export/clear buttons

All UI panels are absolutely positioned overlays on the Three.js canvas, with semi-transparent dark backgrounds.

### Model Context Updates

After each scene change from the UI, call `app.updateModelContext()` with a brief summary (scene name, brick count). This keeps the LLM informed without requiring it to poll `brick_get_scene`.

---

## Build Configuration

- **Vite** with `@vitejs/plugin-react` + `vite-plugin-singlefile` bundles the entire client (React + Three.js) into a single HTML file
- **Server build**: `tsc -p tsconfig.server.json` for declarations, then `bun build` (or `esbuild`) for server.js and index.js
- Three.js (~600KB minified) inlined into the HTML — acceptable for an MCP App resource
- `tsx` used for dev-time server execution (`npm run serve`)

---

## Implementation Phases

### Phase 1: Project Scaffold
Create `package.json`, tsconfigs, `vite.config.ts`, `mcp-app.html`, `src/types.ts`, `src/constants.ts`, `src/engine/BrickCatalog.ts`, `src/vite-env.d.ts`, `src/global.css`.
**Milestone:** `npm install` succeeds, `tsc --noEmit` passes.

### Phase 2: Server Core
Create `server.ts` with `createServer()`, all 14 tools, collision helpers, resource registration. Create `main.ts`.
**Milestone:** `npm run serve` starts, `/mcp` endpoint responds.

### Phase 3: Minimal Client
Create `src/mcp-app.tsx` with `useApp`, `ontoolresult` handler, basic "Connected" display.
**Milestone:** Build produces `dist/mcp-app.html`. Calling `brick_render_scene` opens a connected UI.

### Phase 4: Three.js Rendering
Create `SceneManager`, `GridHelper`, `BrickGeometry`, `BrickMesh`, `SceneReconciler`, `useSceneManager`, `ThreeCanvas`.
**Milestone:** UI shows interactive 3D baseplate with orbit controls. LLM calling `brick_build_structure` shows bricks.

### Phase 5: Interaction System
Create `RaycastHelper`, `CollisionDetector`, `GhostPreview`, `useInteraction`.
**Milestone:** User can click to place bricks with ghost preview, delete, rotate, paint.

### Phase 6: UI Panels
Create `Toolbar`, `BrickSelector`, `ColorPicker`, `SceneInfo`, `BrickBuilder` layout.
**Milestone:** Full interactive UI with all panels and modes.

### Phase 7: Polish
Selection highlighting, `updateModelContext`, camera sync, keyboard shortcuts, error handling, host theme integration.

---

## Verification

1. **Build:** `npm run build` completes without errors
2. **Server:** `npm run serve` starts on port 3001
3. **Basic host test:** Run the MCP Apps basic-host against `http://localhost:3001/mcp`, verify UI loads
4. **LLM tool test:** Call `brick_render_scene` → UI appears. Call `brick_build_structure` with a few bricks → they render in 3D
5. **User interaction test:** Place mode → click grid → brick appears. Delete mode → click brick → removed. Paint mode → click → color changes. Rotate → click → 90° rotation.
6. **Collision test:** Try placing overlapping bricks → red ghost preview, server rejects
7. **Export/import:** Export scene JSON, clear, import → scene restored
