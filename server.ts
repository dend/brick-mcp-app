import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import crypto from "node:crypto";
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

// Return the physical footprint AABBs for a brick (L-shape arms for corners, full AABB otherwise).
// Used for support checks so bricks can't float over a corner's notch.
function getPhysicalFootprint(brick: BrickInstance, brickType: BrickDefinition): AABB[] {
  const aabb = getBrickAABB(brick, brickType);
  if (brickType.category !== 'corner') return [aabb];

  const { x, z } = brick.position;
  const n = brickType.studsX; // corners are square NxN
  const rot = brick.rotation;
  // Rotation determines which corner the notch occupies:
  //   rot=0 → notch at +X,+Z     rot=90 → notch at +X,−Z
  //   rot=180 → notch at −X,−Z   rot=270 → notch at −X,+Z
  const rowAtZMax = rot === 90 || rot === 180;
  const colAtXMax = rot === 180 || rot === 270;

  // Row arm: full width (N studs), 1-stud depth
  const rowArm: AABB = {
    minX: x, maxX: x + n,
    minY: aabb.minY, maxY: aabb.maxY,
    minZ: rowAtZMax ? z + n - 1 : z,
    maxZ: rowAtZMax ? z + n : z + 1,
  };
  // Column arm: 1-stud width, remaining depth (N-1 studs)
  const colArm: AABB = {
    minX: colAtXMax ? x + n - 1 : x,
    maxX: colAtXMax ? x + n : x + 1,
    minY: aabb.minY, maxY: aabb.maxY,
    minZ: rowAtZMax ? z : z + 1,
    maxZ: rowAtZMax ? z + n - 1 : z + n,
  };
  return [rowArm, colArm];
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

// Check if two bricks' physical footprints overlap (L-shape aware).
function physicalOverlap(a: BrickInstance, aType: BrickDefinition, b: BrickInstance, bType: BrickDefinition): boolean {
  const aFoot = getPhysicalFootprint(a, aType);
  const bFoot = getPhysicalFootprint(b, bType);
  for (const af of aFoot) {
    for (const bf of bFoot) {
      if (aabbOverlap(af, bf)) return true;
    }
  }
  return false;
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
    // Use physical footprint overlap (L-shape aware) instead of AABB
    if (physicalOverlap(newBrick, newType, existing, existType)) {
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

// Verify a brick is supported — either on the baseplate (Y=0) or resting on
// another brick's top face with physical footprint overlap (no floating bricks).
// Uses L-shape footprint for corner pieces instead of full AABB.
function checkSupport(bricks: BrickInstance[], brick: BrickInstance, brickType: BrickDefinition): boolean {
  const aabb = getBrickAABB(brick, brickType);
  if (aabb.minY === 0) return true; // On baseplate

  const newFootprint = getPhysicalFootprint(brick, brickType);
  for (const existing of bricks) {
    const et = findBrickType(existing.typeId);
    if (!et) continue;
    const ea = getBrickAABB(existing, et);
    if (ea.maxY !== aabb.minY) continue; // Must be directly below
    // Check physical footprints overlap (not just AABBs)
    const existFootprint = getPhysicalFootprint(existing, et);
    for (const nf of newFootprint) {
      for (const ef of existFootprint) {
        if (nf.minX < ef.maxX && nf.maxX > ef.minX &&
            nf.minZ < ef.maxZ && nf.maxZ > ef.minZ) {
          return true;
        }
      }
    }
  }
  return false;
}

// Find all bricks that would lose support if the scene were mutated.
// Pass the proposed brick list (after the mutation) and it returns IDs of unsupported bricks.
function findUnsupported(bricks: BrickInstance[]): string[] {
  const unsupported: string[] = [];
  for (const brick of bricks) {
    const bt = findBrickType(brick.typeId);
    if (!bt) continue;
    if (!checkSupport(bricks.filter(b => b.id !== brick.id), brick, bt)) {
      unsupported.push(brick.id);
    }
  }
  return unsupported;
}

function generateId(): string {
  return crypto.randomUUID();
}

// ── Server factory ───────────────────────────────────────────────────────────

const resourceUri = "ui://brick-builder/mcp-app.html";

// ── Brick catalog cheat sheet (returned by brick_read_me) ───────────────────

function buildCatalogCheatSheet(): string {
  let sheet = `# Brick Builder Reference

You only need to call brick_read_me once. Do NOT call it again — you will not see anything new.

## Order of Operations (MANDATORY — follow exactly)
1. brick_read_me → Call once to learn the building format and rules (you just did this)
2. brick_get_available → Call to see all available brick types and their dimensions
3. brick_render_scene → Call BEFORE placing any bricks. This opens the 3D viewer for the user. If you skip this step, the user cannot see anything you build.
4. brick_place → Now you can place bricks. Each brick appears live in the viewer as it's placed.
5. brick_get_scene → Call anytime to inspect what's currently built
6. brick_remove_brick → Remove a specific brick by ID (use brick_get_scene to find IDs). Also removes unsupported bricks above it.
7. brick_clear_scene → Call to remove all bricks and start over

CRITICAL: You must call brick_render_scene before your first brick_place call. Placing bricks without rendering the scene first means the user has no viewer open and sees nothing.

## Coordinate System
- Baseplate: ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} studs on the X and Z axes
- Y axis: height in plate units (1 standard brick = 3 Y units, 1 plate = 1 Y unit)
- Valid ranges: X 0–${BASEPLATE_SIZE - 1}, Z 0–${BASEPLATE_SIZE - 1}, Y 0+
- Rotation: "0", "90", "180", or "270" (string)
- Bricks CANNOT float — they must sit on the baseplate (Y=0) or on top of another brick
- ALL positions are relative to the baseplate. A brick's entire footprint (position + size) must stay within the ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} baseplate. Out-of-bounds placements are rejected.
- A brick at position (x, z) with studsX=2, studsZ=4 occupies x to x+2, z to z+4. So the maximum valid x for that brick is ${BASEPLATE_SIZE - 2}, and the maximum valid z is ${BASEPLATE_SIZE - 4}.
- IMPORTANT: Every brick_place response includes a "footprint" showing the brick's exact occupied area: {minX, maxX, minZ, maxZ, topY}. Use footprint.maxX/maxZ to know where to place the NEXT brick adjacent to it. Use footprint.topY for the Y value of the next layer on top.
- brick_get_scene also returns footprints for every brick. ALWAYS read footprints to position new bricks — never calculate positions from scratch when existing bricks have footprints.

## Size & Scale Reference

Height is measured in bricks (1 brick = 3 plates = 3 Y units).
| Category       | Height        | Real-world approx |
|----------------|---------------|-------------------|
| Short          | 1–10 bricks   | up to ~9.6 cm     |
| Medium         | 11–30 bricks  | ~10–28 cm         |
| Tall           | 31–60 bricks  | ~29–57 cm         |
| Tower/Skyscraper | 60+ bricks | 57 cm+            |

Short builds sit flat on a table and are viewed mostly from above (vehicles, small vignettes, garden scenes). Medium builds are eye-catching at table height and viewed straight-on. Tall builds demand vertical presence and often need internal reinforcement.

Width is measured in studs (1 stud = 8 mm).
| Category | Width       | Real-world approx |
|----------|-------------|-------------------|
| Narrow   | 1–8 studs   | up to ~6.4 cm     |
| Medium   | 9–24 studs  | ~7–19 cm          |
| Wide     | 25–48 studs | ~20–38 cm         |
| Massive  | 48+ studs   | 38 cm+            |

Narrow builds are things like a single tower, a lamppost, or a small character model. Medium is the sweet spot for most standalone builds — a small house, a vehicle, a diorama scene. Wide and massive are dioramas, modular-style buildings, and layout sections.

## Colors
Red #cc0000 · Blue #0055bf · Green #237841 · Yellow #f2cd37 · White #ffffff · Black #1b2a34
Orange #fe8a18 · Brown #583927 · Tan #e4cd9e · Dark grey #6b5a5a · Light grey #9ba19d · Dark blue #0a3463

## Footprints

Every brick_place response and brick_get_scene response includes a "footprint" for each brick:
  { minX, maxX, minZ, maxZ, topY }

This tells you the exact area the brick occupies on the baseplate after rotation is applied.
- minX/maxX: the brick spans from minX to maxX along the X axis
- minZ/maxZ: the brick spans from minZ to maxZ along the Z axis
- topY: the top of the brick — use this as the Y value for stacking a brick on top

Use footprints to position new bricks. Do NOT calculate positions manually — read the footprint from the response.
- To place a brick adjacent along X: use the previous brick's footprint.maxX as the new brick's x
- To place a brick adjacent along Z: use the previous brick's footprint.maxZ as the new brick's z
- To stack on top: use the previous brick's footprint.topY as the new brick's y

Example: you place a brick_2x4 at (10, 0, 10) with rotation "90". The response includes:
  footprint: { minX: 10, maxX: 14, minZ: 10, maxZ: 12, topY: 3 }
To place the next brick to the right: x=14 (footprint.maxX)
To place a brick in front: z=12 (footprint.maxZ)
To stack on top: y=3 (footprint.topY)

## Examples

Each brick_place call places ONE brick. Build bottom-up — always place supports before the bricks on top.

### Wall (4 bricks tall)
Place first brick, then use footprint.topY for each subsequent layer:
  brick_place(typeId="brick_1x8", x=10, y=0, z=10, color="#cc0000")
    → footprint: {minX:10, maxX:11, minZ:10, maxZ:18, topY:3}
  brick_place(typeId="brick_1x8", x=10, y=3, z=10, color="#cc0000")  ← y=3 from topY
    → footprint: {minX:10, maxX:11, minZ:10, maxZ:18, topY:6}
  brick_place(typeId="brick_1x8", x=10, y=6, z=10, color="#cc0000")  ← y=6 from topY
  brick_place(typeId="brick_1x8", x=10, y=9, z=10, color="#cc0000")  ← y=9 from topY

### Placing side by side along Z
Use footprint.maxZ from each response for the next brick's z:
  brick_place(typeId="brick_2x4", x=10, y=0, z=10, color="#cc0000")
    → footprint: {minX:10, maxX:12, minZ:10, maxZ:14, topY:3}
  brick_place(typeId="brick_2x4", x=10, y=0, z=14, color="#0055bf")  ← z=14 from maxZ
    → footprint: {minX:10, maxX:12, minZ:14, maxZ:18, topY:3}
  brick_place(typeId="brick_2x4", x=10, y=0, z=18, color="#237841")  ← z=18 from maxZ

### Placing side by side along X
Use footprint.maxX from each response for the next brick's x:
  brick_place(typeId="brick_2x4", x=10, y=0, z=10, color="#cc0000")
    → footprint: {minX:10, maxX:12, minZ:10, maxZ:14, topY:3}
  brick_place(typeId="brick_2x4", x=12, y=0, z=10, color="#0055bf")  ← x=12 from maxX
  brick_place(typeId="brick_2x4", x=14, y=0, z=10, color="#237841")  ← x=14 from maxX

### Rotation changes footprint — always read it
  brick_2x4 at rotation "0":  footprint maxX = x+2, maxZ = z+4
  brick_2x4 at rotation "90": footprint maxX = x+4, maxZ = z+2  (swapped!)

## Rules
- Build BOTTOM-UP: y=0 first, then y=3, y=6, etc. Floating bricks are rejected.
- Use exact typeId values from brick_get_available. Wrong IDs are rejected.
- Each brick_place returns success with the brick ID, or an error explaining why it failed. Read the error and adjust.
- Rotation swaps dimensions — account for this when tiling.
- ALL bricks must fit within the ${BASEPLATE_SIZE}×${BASEPLATE_SIZE} baseplate. The brick's full footprint (position + studs size) must not exceed x=${BASEPLATE_SIZE - 1} or z=${BASEPLATE_SIZE - 1}. Out-of-bounds placements are rejected.
- BEFORE placing a new brick, call brick_get_scene to see where existing bricks are. Position new bricks RELATIVE to what's already placed — adjacent to, on top of, or next to existing bricks. Never guess positions from scratch when there are already bricks in the scene.

## Building Strategy
1. Call brick_get_scene FIRST to see what's already built. Always place new bricks relative to existing ones.
2. Plan the footprint first — lay the ground floor (Y=0)
3. Build upward layer by layer — each layer's Y = previous Y + heightUnits
4. Place one brick at a time. Read each response — if placement fails, adjust and retry.
5. Alternate brick offsets between rows for realistic interlocking
6. Use plates (heightUnits=1) for thin details, trim, and floors
7. Use slopes for rooflines — studs are only on the flat side
8. Build in sections: foundation → walls → roof

## Best Practices
- Work at a scale that makes sense for the detail level you want. Larger scale gives more room for realism.
- Plan your color scheme early. Mixing too many colors by accident is a common mistake — pick 2-3 main colors and 1-2 accent colors.
- Overlap your layers like real brickwork — never stack bricks where joints align vertically. That creates weak seam lines. Offset by half a brick length on alternating rows.
- Distribute weight evenly and think about the base. Wide, flat bases are more stable than tall narrow towers without internal reinforcement.
- Use Technic bricks internally for rigid structural support, especially in large builds.
- Use consistent lighting logic — if your build has a light source, shade the darker side with darker colored bricks.
- Finish exposed surfaces with plates for a clean, polished look. Use slopes for angled surfaces and rooflines.
- For sci-fi and industrial builds, add small technical-looking details (greebling) with 1x1 bricks and plates, but apply with restraint so it doesn't look random.
- Don't be afraid to use brick_clear_scene and rebuild. The best builders redo sections many times.
- Step back and consider the build from the intended viewing angle, not just from above.
`;

  return sheet;
}

// Shared scene state — the host creates separate MCP sessions for the LLM
// and the app iframe, so per-closure state won't be visible across both.
// Module-level state ensures both sessions read/write the same scene.
let scene: SceneData = { name: "Untitled", bricks: [] };

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Brick Builder",
    version: "1.0.0",
  }, {
    instructions: `3D brick construction tool. IMPORTANT: Always call brick_read_me first to learn available brick types and their dimensions before building anything. Do not guess brick type IDs.`,
  });

  function scenePayload(message?: string) {
    return {
      scene,
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

  server.registerTool(
    "brick_read_me",
    {
      description: "Returns the building guide, coordinate system, and examples. Call this BEFORE using any other brick tool for the first time.",
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{ type: "text" as const, text: buildCatalogCheatSheet() }],
    }),
  );

  // ── Tool 2: brick_get_available (model-only, no frame) ────────────────

  server.registerTool(
    "brick_get_available",
    {
      description: "Returns all available brick types with their IDs, dimensions, and categories. Call this to learn what bricks you can use before building.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const byCategory: Record<string, { typeId: string; name: string; studsX: number; studsZ: number; heightUnits: number }[]> = {};
      for (const bt of BRICK_CATALOG) {
        (byCategory[bt.category] ??= []).push({
          typeId: bt.id,
          name: bt.name,
          studsX: bt.studsX,
          studsZ: bt.studsZ,
          heightUnits: bt.heightUnits,
        });
      }
      const result = {
        catalog: byCategory,
        note: "Use exact typeId values in brick_place. Rotation swaps X and Z dimensions (e.g. brick_2x4 at rotation 90 occupies X=4, Z=2).",
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // ── Tool 3: brick_render_scene (model-only, creates frame) ────────────

  registerAppTool(
    server,
    "brick_render_scene",
    {
      title: "Render Brick Scene",
      description: "Opens the 3D brick builder viewer. You MUST call this before brick_place so the user can see the bricks. Call brick_read_me first to learn the brick format.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async () => sceneResult("Scene rendered"),
  );

  // ── Tool 4: brick_place (model-facing, no UI metadata) ────────────────

  server.registerTool(
    "brick_place",
    {
      description: "Place a single brick. Returns the placed brick with its ID, or an error explaining why placement failed. Call brick_render_scene first to open the viewer.",
      inputSchema: {
        typeId: z.string().describe("Brick type ID from brick_get_available"),
        x: z.number().int().describe(`X position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
        y: z.number().int().min(0).describe("Y position in plate-height units (0 = baseplate, +3 per standard brick layer)"),
        z: z.number().int().describe(`Z position in stud units (0 to ${BASEPLATE_SIZE - 1})`),
        rotation: z.enum(["0", "90", "180", "270"]).optional().default("0").describe("Rotation degrees. Swaps X/Z dimensions: e.g. brick_2x4 at 90° occupies X=4, Z=2"),
        color: z.string().optional().default("#cc0000").describe("Hex color"),
      },
    },
    async ({ typeId, x, y, z, rotation, color }) => {
      const brickType = findBrickType(typeId);
      if (!brickType) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown brick type "${typeId}". Call brick_get_available to see valid type IDs.` }) }],
          isError: true,
        };
      }
      const instance: BrickInstance = {
        id: generateId(),
        typeId,
        position: { x, y, z },
        rotation: Number(rotation ?? "0") as 0 | 90 | 180 | 270,
        color: color ?? "#cc0000",
      };
      const boundsError = checkBounds(instance, brickType);
      if (boundsError) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: boundsError, position: { x, y, z }, typeId }) }],
          isError: true,
        };
      }
      if (!checkSupport(scene.bricks, instance, brickType)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "No support — brick must be on baseplate (y=0) or resting on top of another brick", position: { x, y, z }, typeId }) }],
          isError: true,
        };
      }
      if (checkCollision(scene.bricks, instance, brickType)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "Collision — overlaps an existing brick", position: { x, y, z }, typeId }) }],
          isError: true,
        };
      }
      scene.bricks.push(instance);
      const aabb = getBrickAABB(instance, brickType);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          placed: {
            id: instance.id,
            typeId,
            position: { x, y, z },
            rotation: instance.rotation,
            color: instance.color,
            footprint: {
              minX: aabb.minX, maxX: aabb.maxX,
              minZ: aabb.minZ, maxZ: aabb.maxZ,
              topY: aabb.maxY,
            },
          },
          totalBricks: scene.bricks.length,
        }) }],
      };
    },
  );

  // ── Tool 5: brick_get_scene (model-only, no frame) ──────────────────────

  server.registerTool(
    "brick_get_scene",
    {
      description: "Returns the current scene state with all placed bricks and their footprints. Use this before placing new bricks to see where existing bricks are.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const bricksWithFootprints = scene.bricks.map(b => {
        const bt = findBrickType(b.typeId);
        if (!bt) return b;
        const aabb = getBrickAABB(b, bt);
        return {
          ...b,
          footprint: {
            minX: aabb.minX, maxX: aabb.maxX,
            minZ: aabb.minZ, maxZ: aabb.maxZ,
            topY: aabb.maxY,
          },
        };
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          scene: { ...scene, bricks: bricksWithFootprints },
        }) }],
      };
    },
  );

  // ── Tool 6: brick_clear_scene (model-facing, no UI metadata) ──────────

  server.registerTool(
    "brick_clear_scene",
    {
      description: "Remove all bricks from the scene.",
      annotations: { destructiveHint: true },
    },
    async () => {
      const count = scene.bricks.length;
      scene.bricks = [];
      return sceneResult(`Cleared ${count} bricks`);
    },
  );

  // ── Tool 7: brick_remove_brick (model-facing, no UI metadata) ──────────

  server.registerTool(
    "brick_remove_brick",
    {
      description: "Remove a single brick by its ID. Use brick_get_scene to find brick IDs. Also removes any bricks that lose support as a result.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to remove (from brick_get_scene or brick_place response)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ brickId }) => {
      const idx = scene.bricks.findIndex((b) => b.id === brickId);
      if (idx === -1) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: "${brickId}". Call brick_get_scene to see current brick IDs.` }) }],
          isError: true,
        };
      }
      const removed = scene.bricks[idx];
      scene.bricks.splice(idx, 1);
      // Cascade: remove any bricks left unsupported
      let cascadeCount = 0;
      let changed = true;
      while (changed) {
        changed = false;
        const unsupported = findUnsupported(scene.bricks);
        if (unsupported.length > 0) {
          scene.bricks = scene.bricks.filter(b => !unsupported.includes(b.id));
          cascadeCount += unsupported.length;
          changed = true;
        }
      }
      const msg = `Removed ${removed.typeId} from (${removed.position.x}, ${removed.position.y}, ${removed.position.z})` +
        (cascadeCount > 0 ? `. Also removed ${cascadeCount} unsupported brick(s) above it.` : "");
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          removed: { id: removed.id, typeId: removed.typeId, position: removed.position },
          cascadeRemoved: cascadeCount,
          totalBricks: scene.bricks.length,
          message: msg,
        }) }],
      };
    },
  );

  // ── Tool 8: brick_export_scene (no frame) ────────────────────────────────

  server.registerTool(
    "brick_export_scene",
    {
      description: "Export the scene as JSON or a summary.",
      inputSchema: {
        format: z.enum(["json", "summary"]).default("summary").describe("Export format"),
      },
      annotations: { readOnlyHint: true },
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
          content: [{ type: "text" as const, text: JSON.stringify({ name: scene.name, brickCount: 0 }) }],
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
      const summary = {
        name: scene.name,
        brickCount: count,
        dimensions: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
        colors: colorCounts,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(summary) }] };
    },
  );

  // ── Tool 8: brick_add (app-only) ────────────────────────────────────────

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
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ typeId, x, y, z, rotation, color }) => {
      const brickType = findBrickType(typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown brick type "${typeId}". Call brick_read_me to see valid type IDs.` }) }], isError: true };
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
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${typeId} at (${x},${y},${z}): ${boundsError}` }) }], isError: true };
      }
      if (!checkSupport(scene.bricks, instance, brickType)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${typeId} at (${x},${y},${z}): no support — must be on baseplate (Y=0) or resting on top of another brick` }) }], isError: true };
      }
      if (checkCollision(scene.bricks, instance, brickType)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${typeId} at (${x},${y},${z}): collision — overlaps an existing brick` }) }], isError: true };
      }
      scene.bricks.push(instance);
      return sceneResult(`Added ${brickType.name} at (${x}, ${y}, ${z})`);
    },
  );

  // ── Tool 9: brick_remove (app-only) ─────────────────────────────────────

  registerAppTool(
    server,
    "brick_remove",
    {
      title: "Remove Brick",
      description: "Remove a brick by its ID.",
      inputSchema: {
        brickId: z.string().describe("ID of the brick to remove"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ brickId }) => {
      const idx = scene.bricks.findIndex((b) => b.id === brickId);
      if (idx === -1) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: "${brickId}". It may have already been removed. Call brick_get_scene to see current bricks.` }) }], isError: true };
      }
      const removed = scene.bricks[idx];
      scene.bricks.splice(idx, 1);
      // Cascade: remove any bricks left unsupported
      let cascadeCount = 0;
      let changed = true;
      while (changed) {
        changed = false;
        const unsupported = findUnsupported(scene.bricks);
        if (unsupported.length > 0) {
          scene.bricks = scene.bricks.filter(b => !unsupported.includes(b.id));
          cascadeCount += unsupported.length;
          changed = true;
        }
      }

      const msg = `Removed ${removed.typeId} from (${removed.position.x}, ${removed.position.y}, ${removed.position.z})` +
        (cascadeCount > 0 ? `. Also removed ${cascadeCount} unsupported brick(s) above it.` : "");
      return sceneResult(msg);
    },
  );

  // ── Tool 10: brick_move (app-only) ───────────────────────────────────────

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
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ brickId, x, y, z }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: "${brickId}". It may have been removed. Call brick_get_scene to see current bricks.` }) }], isError: true };
      }
      const brickType = findBrickType(brick.typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid brick type "${brick.typeId}" on brick ${brickId}.` }) }], isError: true };
      }
      const moved: BrickInstance = { ...brick, position: { x, y, z } };
      const boundsError = checkBounds(moved, brickType);
      if (boundsError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot move ${brick.typeId} to (${x},${y},${z}): ${boundsError}` }) }], isError: true };
      }
      if (!checkSupport(scene.bricks.filter(b => b.id !== brickId), moved, brickType)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot move ${brick.typeId} to (${x},${y},${z}): no support — must be on baseplate (Y=0) or resting on top of another brick` }) }], isError: true };
      }
      if (checkCollision(scene.bricks, moved, brickType, brickId)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot move ${brick.typeId} to (${x},${y},${z}): collision — overlaps an existing brick` }) }], isError: true };
      }
      const oldPos = { ...brick.position };
      brick.position = { x, y, z };
      // Cascade: remove any bricks left unsupported by this move
      let cascadeCount = 0;
      let changed = true;
      while (changed) {
        changed = false;
        const unsupported = findUnsupported(scene.bricks);
        if (unsupported.length > 0) {
          scene.bricks = scene.bricks.filter(b => !unsupported.includes(b.id));
          cascadeCount += unsupported.length;
          changed = true;
        }
      }

      const msg = `Moved ${brick.typeId} from (${oldPos.x},${oldPos.y},${oldPos.z}) to (${x}, ${y}, ${z})` +
        (cascadeCount > 0 ? `. Removed ${cascadeCount} unsupported brick(s) that were above old position.` : "");
      return sceneResult(msg);
    },
  );

  // ── Tool 11: brick_rotate (app-only) ────────────────────────────────────

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
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ brickId, rotation }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: "${brickId}". It may have been removed. Call brick_get_scene to see current bricks.` }) }], isError: true };
      }
      const brickType = findBrickType(brick.typeId);
      if (!brickType) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid brick type "${brick.typeId}" on brick ${brickId}.` }) }], isError: true };
      }
      const rotated: BrickInstance = { ...brick, rotation: Number(rotation) as 0 | 90 | 180 | 270 };
      const boundsError = checkBounds(rotated, brickType);
      if (boundsError) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot rotate ${brick.typeId} at (${brick.position.x},${brick.position.y},${brick.position.z}) to ${rotation}°: ${boundsError}` }) }], isError: true };
      }
      // Check self-support after rotation (footprint changes)
      if (!checkSupport(scene.bricks.filter(b => b.id !== brickId), rotated, brickType)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot rotate ${brick.typeId} at (${brick.position.x},${brick.position.y},${brick.position.z}) to ${rotation}°: no support after rotation — brick would float` }) }], isError: true };
      }
      if (checkCollision(scene.bricks, rotated, brickType, brickId)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Cannot rotate ${brick.typeId} at (${brick.position.x},${brick.position.y},${brick.position.z}) to ${rotation}°: collision — overlaps an existing brick` }) }], isError: true };
      }
      brick.rotation = Number(rotation) as 0 | 90 | 180 | 270;
      // Cascade: remove any bricks left unsupported by the footprint change
      let cascadeCount = 0;
      let changed = true;
      while (changed) {
        changed = false;
        const unsupported = findUnsupported(scene.bricks);
        if (unsupported.length > 0) {
          scene.bricks = scene.bricks.filter(b => !unsupported.includes(b.id));
          cascadeCount += unsupported.length;
          changed = true;
        }
      }

      const msg = `Rotated ${brick.typeId} at (${brick.position.x}, ${brick.position.y}, ${brick.position.z}) to ${rotation}°` +
        (cascadeCount > 0 ? `. Removed ${cascadeCount} unsupported brick(s) above.` : "");
      return sceneResult(msg);
    },
  );

  // ── Tool 12: brick_paint (app-only) ─────────────────────────────────────

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
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ brickId, color }) => {
      const brick = scene.bricks.find((b) => b.id === brickId);
      if (!brick) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Brick not found: "${brickId}". It may have been removed. Call brick_get_scene to see current bricks.` }) }], isError: true };
      }
      brick.color = color;
      return sceneResult(`Painted ${brick.typeId} at (${brick.position.x}, ${brick.position.y}, ${brick.position.z}) → ${color}`);
    },
  );

  // ── Tool 13: brick_set_camera (app-only) ────────────────────────────────

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
      _meta: { ui: { visibility: ["app"] } },
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

  // ── Tool 14: brick_import_scene (app-only) ──────────────────────────────

  registerAppTool(
    server,
    "brick_import_scene",
    {
      title: "Import Scene",
      description: "Import a scene from JSON.",
      inputSchema: {
        sceneJson: z.string().describe("Scene JSON string"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ sceneJson }) => {
      try {
        const imported = JSON.parse(sceneJson);
        if (!imported.name || !Array.isArray(imported.bricks)) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: 'Invalid scene format — expected { "name": "...", "bricks": [...] }' }) }], isError: true };
        }
        // Validate all bricks: sort by Y and re-add with full validation
        const raw: BrickInstance[] = imported.bricks;
        const sorted = [...raw].sort((a, b) => a.position.y - b.position.y);
        const valid: BrickInstance[] = [];
        let dropped = 0;
        for (const brick of sorted) {
          const bt = findBrickType(brick.typeId);
          if (!bt) { dropped++; continue; }
          if (checkBounds(brick, bt)) { dropped++; continue; }
          if (!checkSupport(valid, brick, bt)) { dropped++; continue; }
          if (checkCollision(valid, brick, bt)) { dropped++; continue; }
          valid.push(brick);
        }
        scene = { name: imported.name, bricks: valid };
        const msg = `Imported scene '${scene.name}' with ${valid.length} bricks` +
          (dropped > 0 ? ` (dropped ${dropped} invalid/floating/colliding bricks)` : "");
        return sceneResult(msg);
      } catch (e) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}` }) }], isError: true };
      }
    },
  );

  // ── Tool 15: brick_set_scene_name (app-only) ────────────────────────────

  registerAppTool(
    server,
    "brick_set_scene_name",
    {
      title: "Set Scene Name",
      description: "Set the scene's display name.",
      inputSchema: {
        name: z.string().describe("New scene name"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ name }) => {
      scene.name = name;
      return sceneResult(`Scene renamed to '${name}'`);
    },
  );

  // ── Tool 16: brick_get_catalog (app-only) ───────────────────────────────

  registerAppTool(
    server,
    "brick_get_catalog",
    {
      title: "Get Brick Catalog",
      description: "Returns the available brick types for the UI.",
      inputSchema: {},
      _meta: { ui: { visibility: ["app"] } },
    },
    async () => {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ catalog: BRICK_CATALOG }) }],
      };
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
