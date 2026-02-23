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

// Block-out zone above the slope face — prevents placing bricks that would float
// above the sloped portion where there is no flat surface.
function getSlopeBlockoutAABB(brick: BrickInstance, brickType: BrickDefinition): AABB | null {
  if (brickType.category !== "slope") return null;
  const { x, y, z } = brick.position;
  const isRotated = brick.rotation === 90 || brick.rotation === 270;
  const sx = isRotated ? brickType.studsZ : brickType.studsX;
  const sz = isRotated ? brickType.studsX : brickType.studsZ;
  const slopeDepth = Math.ceil(brickType.studsZ / 2);
  const topY = y + brickType.heightUnits;
  const blockoutMaxY = topY + brickType.heightUnits;

  // Slope geometry: low side at small Z in base orientation.
  // After rotation the slope face direction changes.
  switch (brick.rotation) {
    case 0:   // slope faces -Z → front at small Z
      return { minX: x, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + slopeDepth };
    case 90:  // slope faces +X → front at large X
      return { minX: x + sx - slopeDepth, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + sz };
    case 180: // slope faces +Z → front at large Z
      return { minX: x, maxX: x + sx, minY: topY, maxY: blockoutMaxY, minZ: z + sz - slopeDepth, maxZ: z + sz };
    case 270: // slope faces -X → front at small X
      return { minX: x, maxX: x + slopeDepth, minY: topY, maxY: blockoutMaxY, minZ: z, maxZ: z + sz };
    default:
      return null;
  }
}

function checkCollision(
  bricks: BrickInstance[],
  newBrick: BrickInstance,
  newType: BrickDefinition,
  excludeId?: string,
): boolean {
  const newAABB = getBrickAABB(newBrick, newType);
  const newBlockout = getSlopeBlockoutAABB(newBrick, newType);
  for (const existing of bricks) {
    if (excludeId && existing.id === excludeId) continue;
    const existType = findBrickType(existing.typeId);
    if (!existType) continue;
    const existAABB = getBrickAABB(existing, existType);
    if (aabbOverlap(newAABB, existAABB)) {
      return true;
    }
    // New brick sits in an existing slope's block-out zone
    const existBlockout = getSlopeBlockoutAABB(existing, existType);
    if (existBlockout && aabbOverlap(newAABB, existBlockout)) {
      return true;
    }
    // New slope's block-out zone covers an existing brick
    if (newBlockout && aabbOverlap(newBlockout, existAABB)) {
      return true;
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

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Brick Builder",
    version: "1.0.0",
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

  // ── Tool 1: brick_render_scene (model-only) ─────────────────────────────

  registerAppTool(
    server,
    "brick_render_scene",
    {
      title: "Render Brick Scene",
      description: "Opens the 3D brick builder UI and shows the current scene.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async () => sceneResult("Scene rendered"),
  );

  // ── Tool 2: brick_build_structure (model-only, no frame) ────────────────
  // Uses server.tool() so it does NOT create a new app frame.
  // The app discovers changes via polling (brick_poll_scene).

  server.tool(
    "brick_build_structure",
    `Batch-add multiple bricks in one call. Skips any brick that would collide or fall outside the baseplate. The baseplate is ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} studs. Valid coordinates: x 0–${BASEPLATE_SIZE - 1}, z 0–${BASEPLATE_SIZE - 1}. Use this to build structures efficiently.`,
    {
      bricks: z.array(
        z.object({
          typeId: z.string().describe("Brick type ID, e.g. 'brick_2x4'"),
          x: z.number().int().describe(`X position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
          y: z.number().int().min(0).describe("Y position in plate-height units"),
          z: z.number().int().describe(`Z position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
          rotation: z.enum(["0", "90", "180", "270"]).optional().default("0").describe("Rotation in degrees"),
          color: z.string().optional().default("#cc0000").describe("Hex color"),
        }),
      ).describe("Array of bricks to add"),
      clearFirst: z.boolean().optional().default(false).describe("Clear scene before adding"),
    },
    async ({ bricks, clearFirst }) => {
      if (clearFirst) {
        scene.bricks = [];
      }
      let added = 0;
      let skipped = 0;
      for (const b of bricks) {
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
        added++;
      }
      sceneVersion++;
      return sceneResult(`Added ${added} bricks${skipped > 0 ? `, skipped ${skipped} (collision/invalid/out-of-bounds)` : ""}`);
    },
  );

  // ── Tool 3: brick_get_scene (model-only, no frame) ──────────────────────

  server.tool(
    "brick_get_scene",
    "Returns the current scene state including all bricks and their positions. Use this to see what the user has built.",
    {},
    async () => sceneResult(),
  );

  // ── Tool 4: brick_export_scene (no frame) ────────────────────────────────

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

  // ── Tool 5: brick_add ───────────────────────────────────────────────────

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

  // ── Tool 6: brick_remove ────────────────────────────────────────────────

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

  // ── Tool 7: brick_move ──────────────────────────────────────────────────

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

  // ── Tool 8: brick_rotate ────────────────────────────────────────────────

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

  // ── Tool 9: brick_paint ─────────────────────────────────────────────────

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

  // ── Tool 10: brick_clear_scene (no frame) ────────────────────────────────

  server.tool(
    "brick_clear_scene",
    "Remove all bricks from the scene.",
    {},
    async () => {
      const count = scene.bricks.length;
      scene.bricks = [];
      sceneVersion++;
      return sceneResult(`Cleared ${count} bricks`);
    },
  );

  // ── Tool 11: brick_set_camera ───────────────────────────────────────────

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

  // ── Tool 12: brick_import_scene ─────────────────────────────────────────

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

  // ── Tool 13: brick_set_scene_name ───────────────────────────────────────

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

  // ── Tool 14: brick_get_catalog (app-only) ───────────────────────────────

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

  // ── Tool 15: brick_poll_scene (app-only) ────────────────────────────────

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
