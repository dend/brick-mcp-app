/**
 * Test harness for the Brick Builder MCP server.
 * Exercises tools directly without any LLM or host involved.
 * Run: npx tsx test-server.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";

function parsePayload(result: unknown): Record<string, unknown> {
  const r = result as { content?: { type: string; text: string }[] };
  const text = r.content?.find((c) => c.type === "text");
  if (!text) throw new Error("No text content in result");
  return JSON.parse(text.text);
}

async function main() {
  console.log("=== Brick Builder Server Test Harness ===\n");

  // Create a single server instance and connect via in-memory transport
  const server = createServer();
  const client = new Client({ name: "test-harness", version: "1.0.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // Helper to call tools
  async function callTool(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    return parsePayload(result);
  }

  // ── Test 1: Initial state ──────────────────────────────────────────────
  console.log("Test 1: Initial state (brick_render_scene)");
  const initial = await callTool("brick_render_scene");
  console.log(`  Version: ${initial.version}`);
  console.log(`  Bricks: ${(initial.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert(initial.version === 0, "Expected version 0");
  console.assert((initial.scene as { bricks: unknown[] }).bricks.length === 0, "Expected 0 bricks");
  console.log("  ✓ PASS\n");

  // ── Test 2: Build structure ────────────────────────────────────────────
  console.log("Test 2: Build structure (3 bricks)");
  const build = await callTool("brick_build_structure", {
    bricks: [
      { typeId: "brick_2x4", x: 0, y: 0, z: 0, color: "#cc0000" },
      { typeId: "brick_2x4", x: 0, y: 0, z: 4, color: "#0055bf" },
      { typeId: "brick_2x4", x: 0, y: 0, z: 8, color: "#00852b" },
    ],
  });
  console.log(`  Version: ${build.version}`);
  console.log(`  Bricks: ${(build.scene as { bricks: unknown[] }).bricks.length}`);
  console.log(`  Message: ${build.message}`);
  console.assert(build.version === 1, `Expected version 1, got ${build.version}`);
  console.assert((build.scene as { bricks: unknown[] }).bricks.length === 3, `Expected 3 bricks, got ${(build.scene as { bricks: unknown[] }).bricks.length}`);
  console.log("  ✓ PASS\n");

  // ── Test 3: State persists — render scene should show 3 bricks ─────────
  console.log("Test 3: Render scene AFTER build (should show 3 bricks)");
  const afterBuild = await callTool("brick_render_scene");
  console.log(`  Version: ${afterBuild.version}`);
  console.log(`  Bricks: ${(afterBuild.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert(afterBuild.version === 1, `Expected version 1, got ${afterBuild.version}`);
  console.assert((afterBuild.scene as { bricks: unknown[] }).bricks.length === 3, `Expected 3 bricks, got ${(afterBuild.scene as { bricks: unknown[] }).bricks.length}`);
  console.log("  ✓ PASS\n");

  // ── Test 4: Get scene should also show 3 bricks ───────────────────────
  console.log("Test 4: Get scene (should show 3 bricks)");
  const getScene = await callTool("brick_get_scene");
  console.log(`  Version: ${getScene.version}`);
  console.log(`  Bricks: ${(getScene.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert((getScene.scene as { bricks: unknown[] }).bricks.length === 3, `Expected 3 bricks`);
  console.log("  ✓ PASS\n");

  // ── Test 5: Add a single brick ─────────────────────────────────────────
  console.log("Test 5: Add single brick (brick_add)");
  const addResult = await callTool("brick_add", {
    typeId: "brick_1x1",
    x: 10,
    y: 0,
    z: 10,
    color: "#ffd700",
  });
  console.log(`  Version: ${addResult.version}`);
  console.log(`  Bricks: ${(addResult.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert(addResult.version === 2, `Expected version 2, got ${addResult.version}`);
  console.assert((addResult.scene as { bricks: unknown[] }).bricks.length === 4, `Expected 4 bricks, got ${(addResult.scene as { bricks: unknown[] }).bricks.length}`);
  console.log("  ✓ PASS\n");

  // ── Test 6: Add another brick — verify both persist ────────────────────
  console.log("Test 6: Add second brick (both should persist)");
  const addResult2 = await callTool("brick_add", {
    typeId: "brick_1x1",
    x: 12,
    y: 0,
    z: 10,
    color: "#ffd700",
  });
  console.log(`  Version: ${addResult2.version}`);
  console.log(`  Bricks: ${(addResult2.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert(addResult2.version === 3, `Expected version 3, got ${addResult2.version}`);
  console.assert((addResult2.scene as { bricks: unknown[] }).bricks.length === 5, `Expected 5 bricks, got ${(addResult2.scene as { bricks: unknown[] }).bricks.length}`);
  console.log("  ✓ PASS\n");

  // ── Test 7: Poll scene ─────────────────────────────────────────────────
  console.log("Test 7: Poll with current version (should be unchanged)");
  const pollUnchanged = await callTool("brick_poll_scene", { knownVersion: 3 });
  console.log(`  Unchanged: ${pollUnchanged.unchanged}`);
  console.assert(pollUnchanged.unchanged === true, `Expected unchanged`);
  console.log("  ✓ PASS\n");

  console.log("Test 8: Poll with old version (should get full scene)");
  const pollChanged = await callTool("brick_poll_scene", { knownVersion: 1 });
  console.log(`  Version: ${pollChanged.version}`);
  console.log(`  Bricks: ${(pollChanged.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert((pollChanged.scene as { bricks: unknown[] }).bricks.length === 5, `Expected 5 bricks`);
  console.log("  ✓ PASS\n");

  // ── Test 9: Clear scene ────────────────────────────────────────────────
  console.log("Test 9: Clear scene");
  const clearResult = await callTool("brick_clear_scene");
  console.log(`  Version: ${clearResult.version}`);
  console.log(`  Bricks: ${(clearResult.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert((clearResult.scene as { bricks: unknown[] }).bricks.length === 0, `Expected 0 bricks`);
  console.log("  ✓ PASS\n");

  // ── Test 10: Build after clear ─────────────────────────────────────────
  console.log("Test 10: Build after clear (state fresh start)");
  const rebuild = await callTool("brick_build_structure", {
    bricks: [
      { typeId: "brick_2x4", x: 5, y: 0, z: 5, color: "#cc0000" },
    ],
  });
  console.log(`  Version: ${rebuild.version}`);
  console.log(`  Bricks: ${(rebuild.scene as { bricks: unknown[] }).bricks.length}`);
  console.assert((rebuild.scene as { bricks: unknown[] }).bricks.length === 1, `Expected 1 brick`);
  console.log("  ✓ PASS\n");

  console.log("=== All tests passed ===");

  await client.close();
  await server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
