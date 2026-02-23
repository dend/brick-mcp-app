# Brick Builder MCP App

A Three.js MCP App for designing 3D brick constructions inside MCP-enabled hosts like Claude Desktop.

## Important rules

- Never use the term "LEGO" anywhere in the codebase, comments, documentation, or UI text. Use "brick" or "brick builder" instead.
- Server is the source of truth for scene state. Both LLM and UI mutate state through MCP tools.

## Specs

Project specifications live in `specs/`. Read these before making architectural decisions:

- `specs/0001-initial-spec/spec.md` — Full initial specification (architecture, types, tools, build config, implementation phases)

## Tech stack

- **Server:** TypeScript, Express, `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`
- **Client:** React, Three.js, bundled as single HTML via Vite + `vite-plugin-singlefile`
- **Runtime:** `tsx` for dev, `esbuild` for production builds

## Key commands

```bash
npm install          # Install dependencies
npm run build        # Build client + server
npm run serve        # Start server (dev mode with tsx)
npm run dev          # Watch + serve concurrently
```

## Project structure

```
server.ts            # MCP server factory, tool registrations, scene state
main.ts              # HTTP/stdio entry point
src/
  mcp-app.tsx        # React entry, MCP App lifecycle
  types.ts           # Shared types (BrickInstance, SceneData, etc.)
  constants.ts       # Dimensions, colors, modes
  engine/            # Scene reconciler, collision detection, brick catalog
  three/             # Three.js scene management, geometry, raycasting
  hooks/             # React hooks for Three.js and interaction
  components/        # UI panels (toolbar, brick selector, color picker)
```
