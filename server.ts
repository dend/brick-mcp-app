import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BrickDefinition } from "./src/bricks/types.js";
import { BRICK_CATALOG, getBrickType } from "./src/bricks/catalog.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

function findBrickType(typeId: string): BrickDefinition | undefined {
  return getBrickType(typeId);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface BrickInstance {
  id: string;
  typeId: string;
  position: { x: number; y: number; z: number };
  rotation: 0 | 90 | 180 | 270;
  color: string;
}

interface SceneData {
  name: string;
  bricks: BrickInstance[];
}

interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

// ── Collision helpers ────────────────────────────────────────────────────────

function getBrickAABB(brick: BrickInstance, brickType: BrickDefinition): AABB {
  const { x, y, z } = brick.position;
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? brickType.studsZ : brickType.studsX;
  const sz = isRotated ? brickType.studsX : brickType.studsZ;
  return {
    minX: x, maxX: x + sx,
    minY: y, maxY: y + brickType.heightUnits,
    minZ: z, maxZ: z + sz,
  };
}

function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

// Compute world-space block-out AABBs from a brick's definition, applying rotation.
function getBlockoutAABBs(brick: BrickInstance, brickType: BrickDefinition): AABB[] {
  if (!brickType.blockout?.length) return [];
  const { x, y, z } = brick.position;
  const cx = brickType.studsX / 2;
  const cz = brickType.studsZ / 2;
  const topY = y + brickType.heightUnits;
  const rotRad = -(brick.rotation * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);

  return brickType.blockout.map(bo => {
    // Rotate the 4 corners of the blockout footprint around the brick center
    const corners: [number, number][] = [
      [bo.minX - cx, bo.minZ - cz],
      [bo.maxX - cx, bo.minZ - cz],
      [bo.minX - cx, bo.maxZ - cz],
      [bo.maxX - cx, bo.maxZ - cz],
    ];
    let rMinX = Infinity, rMaxX = -Infinity;
    let rMinZ = Infinity, rMaxZ = -Infinity;
    for (const [dx, dz] of corners) {
      const rx = dx * cos - dz * sin + cx;
      const rz = dx * sin + dz * cos + cz;
      rMinX = Math.min(rMinX, rx);
      rMaxX = Math.max(rMaxX, rx);
      rMinZ = Math.min(rMinZ, rz);
      rMaxZ = Math.max(rMaxZ, rz);
    }
    return {
      minX: x + Math.round(rMinX),
      maxX: x + Math.round(rMaxX),
      minY: topY,
      maxY: topY + bo.height,
      minZ: z + Math.round(rMinZ),
      maxZ: z + Math.round(rMaxZ),
    };
  });
}

// Does `topAABB` have stud support from the brick below (`bottomAABB`)?
// Returns true if the top brick sits directly on the bottom brick's studs
// (the part of the bottom brick's top face NOT covered by blockout zones).
function hasStudSupport(
  topAABB: AABB,
  bottomAABB: AABB,
  bottomBlockouts: AABB[],
): boolean {
  // Top brick must sit exactly on the bottom brick's top
  if (topAABB.minY !== bottomAABB.maxY) return false;

  // Compute XZ intersection of top brick and bottom brick footprint
  const interMinX = Math.max(topAABB.minX, bottomAABB.minX);
  const interMaxX = Math.min(topAABB.maxX, bottomAABB.maxX);
  const interMinZ = Math.max(topAABB.minZ, bottomAABB.minZ);
  const interMaxZ = Math.min(topAABB.maxZ, bottomAABB.maxZ);
  if (interMinX >= interMaxX || interMinZ >= interMaxZ) return false;

  // Check if the XZ intersection is entirely within any single blockout zone.
  // If so, there are no studs in the overlap → no support.
  for (const bo of bottomBlockouts) {
    if (interMinX >= bo.minX && interMaxX <= bo.maxX &&
        interMinZ >= bo.minZ && interMaxZ <= bo.maxZ) {
      return false;
    }
  }
  // Intersection extends beyond blockout zones → studs exist → supported
  return true;
}

function checkCollision(
  bricks: BrickInstance[],
  newBrick: BrickInstance,
  newType: BrickDefinition,
  excludeId?: string,
): boolean {
  const newAABB = getBrickAABB(newBrick, newType);
  const newBlockouts = getBlockoutAABBs(newBrick, newType);
  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = findBrickType(existing.typeId);
    if (!existType) continue;
    const existAABB = getBrickAABB(existing, existType);
    if (aabbOverlap(newAABB, existAABB)) {
      return true;
    }
    // New brick sits in an existing brick's block-out zone
    const existBlockouts = getBlockoutAABBs(existing, existType);
    for (const bo of existBlockouts) {
      if (aabbOverlap(newAABB, bo)) {
        // Allow if new brick also connects to studs on the same brick
        if (!hasStudSupport(newAABB, existAABB, existBlockouts)) return true;
      }
    }
    // New brick's block-out zone covers an existing brick
    for (const bo of newBlockouts) {
      if (aabbOverlap(bo, existAABB)) {
        // Allow if existing brick connects to studs on the new brick
        if (!hasStudSupport(existAABB, newAABB, newBlockouts)) return true;
      }
    }
  }
  return false;
}

// ── Baseplate bounds ─────────────────────────────────────────────────────────

const BASEPLATE_SIZE = 48;

function checkBounds(brick: BrickInstance, brickType: BrickDefinition): string | null {
  const aabb = getBrickAABB(brick, brickType);
  if (aabb.minX < 0 || aabb.maxX > BASEPLATE_SIZE) {
    return `Brick extends outside baseplate on X axis (valid: 0–${BASEPLATE_SIZE - 1})`;
  }
  if (aabb.minZ < 0 || aabb.maxZ > BASEPLATE_SIZE) {
    return `Brick extends outside baseplate on Z axis (valid: 0–${BASEPLATE_SIZE - 1})`;
  }
  if (aabb.minY < 0) {
    return "Brick is below the baseplate";
  }
  return null;
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── Server factory ───────────────────────────────────────────────────────────

const resourceUri = "ui://brick-builder/mcp-app.html";

// ── Brick catalog cheat sheet (returned by brick_read_me) ───────────────────

function buildCatalogCheatSheet(): string {
  const byCategory: Record<string, BrickDefinition[]> = {};
  for (const bt of BRICK_CATALOG) {
    (byCategory[bt.category] ??= []).push(bt);
  }

  let sheet = `# Brick Builder Reference

## IMPORTANT: Always call brick_read_me FIRST
Before building anything, call brick_read_me to learn available brick types.
Do NOT guess brick type IDs — use only the IDs listed below.

## Available Brick Types

`;

  for (const [cat, bricks] of Object.entries(byCategory)) {
    sheet += `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}s\n`;
    sheet += `| ID | Name | Width (X) | Depth (Z) | Height (Y) |\n`;
    sheet += `|----|------|-----------|-----------|------------|\n`;
    for (const bt of bricks) {
      sheet += `| ${bt.id} | ${bt.name} | ${bt.studsX} | ${bt.studsZ} | ${bt.heightUnits} |\n`;
    }
    sheet += `\n`;
  }

  sheet += `## Coordinate System
- Baseplate: ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} studs (X and Z axes)
- Y axis: height in plate units (1 brick height = 3 plate units)
- Valid X: 0–${BASEPLATE_SIZE - 1}, Z: 0–${BASEPLATE_SIZE - 1}, Y: 0+
- Rotation: 0, 90, 180, or 270 degrees

## Height Guide
- 1 plate = 1 height unit (Y)
- 1 brick = 3 height units (Y)
- To stack bricks: next brick Y = current Y + current brick's heightUnits
- Example: brick at Y=0 (height 3) → next brick at Y=3

## Suggested Colors
- Red: #cc0000
- Blue: #0055bf
- Yellow: #f2cd37
- Green: #237841
- White: #ffffff
- Black: #1b2a34
- Orange: #fe8a18
- Dark grey: #6b5a5a
- Light grey: #9ba19d
- Brown: #583927
- Tan: #e4cd9e
- Dark blue: #0a3463

## Building Tips
- Build bottom-up, layer by layer (low Y first)
- Use 2×4 and 2×3 bricks for structural walls — they're strong
- Offset bricks between rows for realistic interlocking pattern
- Use plates (height 1) for thin layers and detailing
- Slopes create rooflines and angled surfaces
- Technic bricks have pin holes for mechanical connections
- Corner bricks create L-shaped joints

## Tool Usage
1. Call brick_read_me first (this tool) — you only need to call it once
2. Call brick_render_scene to open the 3D viewer
3. Call brick_place to add bricks — you can place 1 or many at a time
4. The user sees each brick appear live in the 3D view as you place them
5. Call brick_get_scene to inspect what's currently built
6. Call brick_clear_scene to start fresh
`;

  return sheet;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Brick Builder",
    version: "1.0.0",
  }, {
    instructions: `3D brick construction tool. IMPORTANT: Always call brick_read_me first to learn available brick types and their dimensions before building anything. Do not guess brick type IDs.`,
  });

  // Per-session scene state
  let scene: SceneData = { name: "Untitled", bricks: [] };
  let sceneVersion = 0;

  function scenePayload(message?: string) {
    return {
      scene,
      version: sceneVersion,
      ...(message ? { message } : {}),
    };
  }

  function sceneResult(message?: string) {
    const payload = scenePayload(message);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    };
  }

  // ── Tool 1: brick_read_me (model-only, no frame) ───────────────────────
  // Like Excalidraw's read_me — returns comprehensive cheat sheet with
  // available brick types, coordinate system, colors, and building tips.

  server.tool(
    "brick_read_me",
    "Returns the complete brick catalog and building guide. ALWAYS call this first before building anything — it lists all available brick type IDs, dimensions, the coordinate system, color palette, and building tips. You only need to call it once per conversation.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: buildCatalogCheatSheet() }],
    }),
  );

  // ── Tool 2: brick_render_scene (model-only, creates frame) ────────────

  registerAppTool(
    server,
    "brick_render_scene",
    {
      title: "Render Brick Scene",
      description: "Opens the 3D brick builder UI. Call brick_read_me first to learn available bricks, then call this to open the viewer, then use brick_place to add bricks.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async () => sceneResult("Scene rendered"),
  );

  // ── Tool 3: brick_place (model-only, no frame) ───────────────────────
  // Replaces brick_build_structure with a streaming-friendly tool.
  // Uses server.tool() so it does NOT create a new app frame.
  // Bricks are added one at a time with delays so the app's adaptive
  // polling picks them up for live building visualization.

  server.tool(
    "brick_place",
    `Place one or more bricks. Each brick appears live in the 3D viewer as it's placed. Skips bricks that collide or fall outside bounds. The baseplate is ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} studs. You can call this multiple times to build incrementally — e.g. foundation first, then walls, then roof.`,
    {
      bricks: z.array(
        z.object({
          typeId: z.string().describe("Brick type ID from brick_read_me catalog"),
          x: z.number().int().describe(`X position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
          y: z.number().int().min(0).describe("Y position in plate-height units (0 = ground)"),
          z: z.number().int().describe(`Z position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
          rotation: z.enum(["0", "90", "180", "270"]).optional().default("0").describe("Rotation in degrees"),
          color: z.string().optional().default("#cc0000").describe("Hex color"),
        }),
      ).describe("Array of bricks to place"),
      clearFirst: z.boolean().optional().default(false).describe("Clear scene before placing"),
    },
    async ({ bricks, clearFirst }) => {
      if (clearFirst) {
        scene.bricks = [];
        sceneVersion++;
      }
      let added = 0;
      let skipped = 0;
      const BRICK_DELAY_MS = 80; // ms between bricks for live building effect
      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        const brickType = findBrickType(b.typeId);
        if (!brickType) {
          skipped++;
          continue;
        }
        const instance: BrickInstance = {
          id: generateId(),
          typeId: b.typeId,
          position: { x: b.x, y: b.y, z: b.z },
          rotation: Number(b.rotation) as 0 | 90 | 180 | 270,
          color: b.color ?? "#cc0000",
        };
        if (checkBounds(instance, brickType)) {
          skipped++;
          continue;
        }
        if (checkCollision(scene.bricks, instance, brickType)) {
          skipped++;
          continue;
        }
        scene.bricks.push(instance);
        sceneVersion++;
        added++;
        // Yield to event loop so poll requests see each brick as it's placed
        if (i < bricks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, BRICK_DELAY_MS));
        }
      }
      return sceneResult(`Placed ${added} bricks${skipped > 0 ? `, skipped ${skipped} (collision/invalid/out-of-bounds)` : ""}`);
    },
  );

  // ── Tool 4: brick_get_scene (model-only, no frame) ──────────────────────

  server.tool(
    "brick_get_scene",
    "Returns the current scene state including all bricks and their positions. Use this to see what the user has built or to check your work.",
    {},
    async () => sceneResult(),
  );

  // ── Tool 5: brick_clear_scene (no frame) ──────────────────────────────

  server.tool(
    "brick_clear_scene",
    "Remove all bricks from the scene. Use this to start fresh.",
    {},
    async () => {
      const count = scene.bricks.length;
      scene.bricks = [];
      sceneVersion++;
      return sceneResult(`Cleared ${count} bricks`);
    },
  );

  // ── Tool 6: brick_export_scene (no frame) ────────────────────────────────

  server.tool(
    "brick_export_scene",
    "Export the scene as JSON or a human-readable summary.",
    {
      format: z.enum(["json", "summary"]).default("summary").describe("Export format"),
    },
    async ({ format }) => {
      if (format === "json") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(scene, null, 2) }],
        };
      }
      // Summary
      const count = scene.bricks.length;
      if (count === 0) {
        return {
          content: [{ type: "text" as const, text: `Scene '${scene.name}': empty (no bricks).` }],
        };
      }
      const colorCounts: Record<string, number> = {};
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const b of scene.bricks) {
        colorCounts[b.color] = (colorCounts[b.color] || 0) + 1;
        const bt = findBrickType(b.typeId);
        if (!bt) continue;
        const aabb = getBrickAABB(b, bt);
        minX = Math.min(minX, aabb.minX); maxX = Math.max(maxX, aabb.maxX);
        minY = Math.min(minY, aabb.minY); maxY = Math.max(maxY, aabb.maxY);
        minZ = Math.min(minZ, aabb.minZ); maxZ = Math.max(maxZ, aabb.maxZ);
      }
      const colorSummary = Object.entries(colorCounts)
        .map(([hex, n]) => `${n} ${hex}`)
        .join(", ");
      const text = `Scene '${scene.name}': ${count} bricks. Dimensions: ${maxX - minX}×${maxY - minY}×${maxZ - minZ} studs. Colors: ${colorSummary}.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ── Tool 7: brick_add (app-only) ────────────────────────────────────────

  registerAppTool(
    server,
    "brick_add",
    {
      title: "Add Brick",
      description: `Add a single brick to the scene. The baseplate is ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} studs. Valid coordinates: x 0–${BASEPLATE_SIZE - 1}, z 0–${BASEPLATE_SIZE - 1}.`,
      inputSchema: {
        typeId: z.string().describe("Brick type ID"),
        x: z.number().int().describe(`X position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
        y: z.number().int().min(0).describe("Y position (plate-height units)"),
        z: z.number().int().describe(`Z position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
        rotation: z.enum(["0", "90", "180", "270"]).optional().default("0").describe("Rotation degrees"),
        color: z.string().optional().default("#cc0000").describe("Hex color"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ typeId, x, y, z, rotation, color }) => {
      const brickType = findBrickType(typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown brick type: ${typeId}` }) }], isError: true };
      }
      const instance: BrickInstance = {
        id: generateId(),
        typeId,
        position: { x, y, z },
        rotation: Number(rotation) as 0 | 90 | 180 | 270,
        color: color ?? "#cc0000",
      };
      const boundsError = checkBounds(instance, brickType);
      if (boundsError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: boundsError }) }], isError: true };
      }
      if (checkCollision(scene.bricks, instance, brickType)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Collision detected — brick overlaps existing brick" }) }], isError: true };
      }
      scene.bricks.push(instance);
      sceneVersion++;
      return sceneResult(`Added ${brickType.name} at (${x}, ${y}, ${z})`);
    },
  );

  // ── Tool 8: brick_remove (app-only) ─────────────────────────────────────

  registerAppTool(
    server,
    "brick_remove",
    {
      title: "Remove Brick",
      description: "Remove a brick by its ID.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to remove"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ brickId }) => {
      const idx = scene.bricks.findIndex((b) => b.id === brickId);
      if (idx === -1) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: ${brickId}` }) }], isError: true };
      }
      scene.bricks.splice(idx, 1);
      sceneVersion++;
      return sceneResult("Brick removed");
    },
  );

  // ── Tool 9: brick_move (app-only) ───────────────────────────────────────

  registerAppTool(
    server,
    "brick_move",
    {
      title: "Move Brick",
      description: "Move a brick to a new position.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to move"),
        x: z.number().int().describe("New X position"),
        y: z.number().int().min(0).describe("New Y position"),
        z: z.number().int().describe("New Z position"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ brickId, x, y, z }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: ${brickId}` }) }], isError: true };
      }
      const brickType = findBrickType(brick.typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid brick type" }) }], isError: true };
      }
      const moved: BrickInstance = { ...brick, position: { x, y, z } };
      if (checkCollision(scene.bricks, moved, brickType, brickId)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Collision at target position" }) }], isError: true };
      }
      brick.position = { x, y, z };
      sceneVersion++;
      return sceneResult(`Brick moved to (${x}, ${y}, ${z})`);
    },
  );

  // ── Tool 10: brick_rotate (app-only) ────────────────────────────────────

  registerAppTool(
    server,
    "brick_rotate",
    {
      title: "Rotate Brick",
      description: "Set a brick's rotation.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to rotate"),
        rotation: z.enum(["0", "90", "180", "270"]).describe("New rotation in degrees"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ brickId, rotation }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: ${brickId}` }) }], isError: true };
      }
      const brickType = findBrickType(brick.typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid brick type" }) }], isError: true };
      }
      const rotated: BrickInstance = { ...brick, rotation: Number(rotation) as 0 | 90 | 180 | 270 };
      if (checkCollision(scene.bricks, rotated, brickType, brickId)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Collision after rotation" }) }], isError: true };
      }
      brick.rotation = Number(rotation) as 0 | 90 | 180 | 270;
      sceneVersion++;
      return sceneResult(`Brick rotated to ${rotation}°`);
    },
  );

  // ── Tool 11: brick_paint (app-only) ─────────────────────────────────────

  registerAppTool(
    server,
    "brick_paint",
    {
      title: "Paint Brick",
      description: "Change a brick's color.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to paint"),
        color: z.string().describe("New hex color"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ brickId, color }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: ${brickId}` }) }], isError: true };
      }
      brick.color = color;
      sceneVersion++;
      return sceneResult(`Brick painted ${color}`);
    },
  );

  // ── Tool 12: brick_set_camera (app-only) ────────────────────────────────

  registerAppTool(
    server,
    "brick_set_camera",
    {
      title: "Set Camera",
      description: "Set the camera position and look-at target.",
      inputSchema: {
        posX: z.number().describe("Camera X position"),
        posY: z.number().describe("Camera Y position"),
        posZ: z.number().describe("Camera Z position"),
        targetX: z.number().optional().default(0).describe("Look-at X"),
        targetY: z.number().optional().default(0).describe("Look-at Y"),
        targetZ: z.number().optional().default(0).describe("Look-at Z"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ posX, posY, posZ, targetX, targetY, targetZ }) => {
      const payload = {
        scene,
        camera: {
          position: { x: posX, y: posY, z: posZ },
          target: { x: targetX ?? 0, y: targetY ?? 0, z: targetZ ?? 0 },
        },
        message: "Camera updated",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );

  // ── Tool 13: brick_import_scene (app-only) ──────────────────────────────

  registerAppTool(
    server,
    "brick_import_scene",
    {
      title: "Import Scene",
      description: "Import a scene from JSON.",
      inputSchema: {
        sceneJson: z.string().describe("Scene JSON string"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ sceneJson }) => {
      try {
        const imported = JSON.parse(sceneJson);
        if (!imported.name || !Array.isArray(imported.bricks)) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid scene format" }) }], isError: true };
        }
        scene = imported;
        sceneVersion++;
        return sceneResult(`Imported scene '${scene.name}' with ${scene.bricks.length} bricks`);
      } catch {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid JSON" }) }], isError: true };
      }
    },
  );

  // ── Tool 14: brick_set_scene_name (app-only) ────────────────────────────

  registerAppTool(
    server,
    "brick_set_scene_name",
    {
      title: "Set Scene Name",
      description: "Set the scene's display name.",
      inputSchema: {
        name: z.string().describe("New scene name"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ name }) => {
      scene.name = name;
      sceneVersion++;
      return sceneResult(`Scene renamed to '${name}'`);
    },
  );

  // ── Tool 15: brick_get_catalog (app-only) ───────────────────────────────

  registerAppTool(
    server,
    "brick_get_catalog",
    {
      title: "Get Brick Catalog",
      description: "Returns the available brick types for the UI.",
      inputSchema: {},
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ catalog: BRICK_CATALOG }) }],
      };
    },
  );

  // ── Tool 16: brick_poll_scene (app-only) ────────────────────────────────

  registerAppTool(
    server,
    "brick_poll_scene",
    {
      title: "Poll Scene",
      description: "Poll for scene changes. Returns unchanged:true if version matches, otherwise returns full scene.",
      inputSchema: {
        knownVersion: z.number().int().optional().describe("Last known scene version"),
      },
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async ({ knownVersion }) => {
      if (knownVersion !== undefined && knownVersion === sceneVersion) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ version: sceneVersion, unchanged: true }) }],
        };
      }
      return sceneResult();
    },
  );

  // ── Resource registration ───────────────────────────────────────────────

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "Brick Builder UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
