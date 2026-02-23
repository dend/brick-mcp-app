# Brick Builder MCP App

A Three.js MCP App for designing 3D brick constructions inside MCP-enabled hosts like Claude Desktop and VS Code. Build interactively in the 3D viewport or let the AI build structures for you through tool calls.

## Quick Start

```sh
git clone https://github.com/<owner>/brick-mcp-app.git
cd brick-mcp-app
npm install
npm run build
npm run serve
```

The server starts at **http://localhost:3001/mcp**.

## Prerequisites

- **Node.js** 20+
- **npm** 10+

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Build client (Vite) + server (esbuild) |
| `npm run serve` | Start server in dev mode (tsx, auto-reload) |
| `npm run dev` | Watch client + serve concurrently |
| `npm start` | Build then serve (one command) |

## Connecting to Claude Desktop

Claude Desktop requires a stdio bridge for local HTTP servers. Use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) to proxy the connection.

### 1. Build and start the server

```sh
npm run build
npm run serve
```

Leave this running in a terminal.

### 2. Edit your Claude Desktop config

Open the config file for your platform:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the server entry:

```json
{
  "mcpServers": {
    "brick-builder": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3001/mcp"]
    }
  }
}
```

### 3. Restart Claude Desktop

After restarting, the brick builder tools will be available. Ask Claude to "render the brick scene" or "build a small house" to get started.

## Connecting to VS Code

VS Code supports streamable HTTP MCP servers natively.

### Option A: Workspace config (recommended)

Create `.vscode/mcp.json` in your workspace root:

```json
{
  "servers": {
    "brick-builder": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

### Option B: Command Palette

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **MCP: Add Server**
3. Choose **HTTP** as the server type
4. Enter the URL: `http://localhost:3001/mcp`
5. Select **Workspace** to save to `.vscode/mcp.json`

### Option C: VS Code settings.json

Add to your `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "brick-builder": {
        "type": "http",
        "url": "http://localhost:3001/mcp"
      }
    }
  }
}
```

## Connecting to Claude Code (CLI)

```sh
claude mcp add --transport http brick-builder http://localhost:3001/mcp
```

Or add a `.mcp.json` file at your project root:

```json
{
  "mcpServers": {
    "brick-builder": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

## MCP Tools

The server exposes 14 tools for building and managing brick scenes.

### Tools the AI uses

| Tool | Description |
|------|-------------|
| `brick_render_scene` | Opens the 3D builder UI |
| `brick_build_structure` | Batch-add many bricks in one call |
| `brick_get_scene` | Read the current scene state |
| `brick_export_scene` | Export as JSON or human-readable summary |

### Tools both AI and UI use

| Tool | Description |
|------|-------------|
| `brick_add` | Add a single brick |
| `brick_remove` | Remove a brick by ID |
| `brick_move` | Move a brick to a new position |
| `brick_rotate` | Set a brick's rotation (0/90/180/270) |
| `brick_paint` | Change a brick's color |
| `brick_clear_scene` | Remove all bricks |
| `brick_set_camera` | Set camera position and target |
| `brick_import_scene` | Import a scene from JSON |
| `brick_set_scene_name` | Set the scene's display name |

### UI-only tools

| Tool | Description |
|------|-------------|
| `brick_get_catalog` | Fetch the available brick types |

## Interactive UI

The 3D viewport supports six interaction modes, switchable via the toolbar or keyboard shortcuts:

| Mode | Shortcut | Action |
|------|----------|--------|
| Place | `1` | Click the grid to place bricks. Ghost preview shows valid (green) or invalid (red) positions. |
| Select | `2` | Click a brick to select it (highlighted). |
| Move | `3` | Drag a brick to a new position. |
| Rotate | `4` | Click a brick to rotate it 90 degrees. |
| Delete | `5` | Click a brick to remove it. |
| Paint | `6` | Click a brick to change its color to the selected color. |

**Additional shortcuts:**
- `R` — Cycle rotation (0 / 90 / 180 / 270) in place mode
- `Delete` — Remove the selected brick
- `Escape` — Deselect / cancel drag

## Brick Types

20 brick types across three categories:

- **Bricks** (standard height): 1x1, 1x2, 1x3, 1x4, 1x6, 1x8, 2x2, 2x3, 2x4, 2x6, 2x8
- **Plates** (1/3 height): 1x1, 1x2, 1x4, 2x2, 2x4, 2x6, 4x4
- **Slopes**: 1x2, 2x2, 2x3

## Architecture

```
Host (Claude Desktop / VS Code)
├── Client (React + Three.js, bundled as single HTML)
│   └── Communicates via callServerTool (postMessage)
└── Server (Express + MCP SDK)
    └── Per-session scene state, collision detection, 14 tools
```

The **server is the source of truth**. Both the AI and the UI mutate state through MCP tools. The server validates all operations (collision detection, type validation) and returns the full scene. The client reconciles its Three.js scene graph against the server response.

## Project Structure

```
├── main.ts              # HTTP/stdio entry point
├── server.ts            # MCP server, all 14 tools, scene state
├── mcp-app.html         # Vite entry HTML
├── src/
│   ├── mcp-app.tsx      # React entry, MCP App lifecycle
│   ├── types.ts         # Shared types
│   ├── constants.ts     # Dimensions, colors, modes
│   ├── engine/
│   │   ├── BrickCatalog.ts       # 20 brick type definitions
│   │   ├── SceneReconciler.ts    # Diffs server state → Three.js
│   │   └── CollisionDetector.ts  # Client-side AABB for ghost preview
│   ├── three/
│   │   ├── SceneManager.ts       # Renderer, camera, controls, lighting
│   │   ├── BrickGeometry.ts      # Parametric geometry + stud generation
│   │   ├── BrickMesh.ts          # BrickInstance → Three.js mesh
│   │   ├── GhostPreview.ts       # Placement preview
│   │   ├── GridHelper.ts         # Baseplate + grid + raycast plane
│   │   └── RaycastHelper.ts      # Placement & selection raycasting
│   ├── hooks/
│   │   ├── useSceneManager.ts    # Three.js lifecycle in React
│   │   └── useInteraction.ts     # Mouse/keyboard per mode
│   └── components/
│       ├── BrickBuilder.tsx      # Main layout
│       ├── ThreeCanvas.tsx       # Canvas container
│       ├── Toolbar.tsx           # Mode buttons
│       ├── BrickSelector.tsx     # Brick type catalog panel
│       ├── ColorPicker.tsx       # Color swatch row
│       └── SceneInfo.tsx         # Scene name, count, export/clear
```

## Testing with basic-host

You can test the app locally using the MCP Apps SDK basic-host:

```sh
# Terminal 1: start the server
npm run build && npm run serve

# Terminal 2: run basic-host
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```

## License

MIT — see [LICENSE](LICENSE).
