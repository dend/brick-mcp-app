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
npm run download:ldraw # One-time: download LDraw parts library
npm run build        # Build client + server
npm run serve        # Start server (dev mode with tsx)
npm run dev          # Watch + serve concurrently
```

## Architecture

- Scene state is **module-level** (shared across MCP sessions) — the host creates separate sessions for LLM and app iframe
- The UI polls `brick_get_scene` every 1s to pick up LLM-initiated changes
- `brick_place` returns footprint data (`{minX, maxX, minZ, maxZ, topY}`) so the LLM can position bricks precisely
- Only `brick_render_scene` has `resourceUri` — all other model tools use plain `server.registerTool` to avoid iframe reloads
