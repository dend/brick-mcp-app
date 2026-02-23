/**
 * HTTP integration test for the Brick Builder MCP server.
 * Starts the server as a child process and sends HTTP requests.
 * Run: npx tsx test-http.ts
 */
import { spawn, type ChildProcess } from "node:child_process";

const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}/mcp`;
let sessionId: string | undefined;
let serverProc: ChildProcess;

async function mcpRequest(body: unknown): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const respSessionId = res.headers.get("mcp-session-id");
  if (respSessionId) sessionId = respSessionId;

  const text = await res.text();
  let parsed: unknown;
  // Handle SSE format: "event: message\ndata: {...}\n\n"
  if (text.startsWith("event:") || text.includes("\ndata:")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    if (dataLine) {
      try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { parsed = text; }
    } else {
      parsed = text;
    }
  } else {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return { status: res.status, body: parsed };
}

function parseToolResult(responseBody: unknown): Record<string, unknown> {
  const resp = responseBody as { result?: { content?: { type: string; text: string }[] } };
  const textContent = resp.result?.content?.find((c) => c.type === "text");
  if (!textContent) throw new Error(`No text content in: ${JSON.stringify(responseBody).slice(0, 300)}`);
  return JSON.parse(textContent.text);
}

function brickCount(payload: Record<string, unknown>): number {
  return (payload.scene as { bricks: unknown[] }).bricks.length;
}

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProc = spawn("npx", ["tsx", "main.ts"], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc.stdout!.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("listening")) resolve();
    });
    serverProc.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("EADDRINUSE")) reject(new Error("Port in use"));
    });
    setTimeout(() => reject(new Error("Server start timeout")), 10000);
  });
}

async function main() {
  console.log("Starting server...");
  await startServer();
  console.log("Server started.\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.log(`  ✗ FAIL: ${msg}`);
      failed++;
    } else {
      passed++;
    }
  }

  try {
    // Initialize
    console.log("Test 1: Initialize MCP session");
    const init = await mcpRequest({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
    });
    assert(init.status === 200, `Expected 200, got ${init.status}`);
    assert(sessionId !== undefined, "Expected session ID in response");
    console.log(`  Session: ${sessionId}`);
    console.log("  ✓ PASS\n");

    // Send initialized notification
    await mcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" });

    // Build structure
    console.log("Test 2: Build structure (3 bricks)");
    const build = await mcpRequest({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "brick_build_structure", arguments: {
        bricks: [
          { typeId: "brick_2x4", x: 0, y: 0, z: 0, color: "#cc0000" },
          { typeId: "brick_2x4", x: 0, y: 0, z: 4, color: "#0055bf" },
          { typeId: "brick_2x4", x: 0, y: 0, z: 8, color: "#00852b" },
        ],
      }},
    });
    const buildP = parseToolResult(build.body);
    console.log(`  Version: ${buildP.version}, Bricks: ${brickCount(buildP)}`);
    assert(brickCount(buildP) === 3, `Expected 3 bricks, got ${brickCount(buildP)}`);
    console.log("  ✓ PASS\n");

    // KEY TEST: Render scene in SAME session — should show 3 bricks
    console.log("Test 3: Render scene AFTER build (state must persist!)");
    const render = await mcpRequest({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "brick_render_scene", arguments: {} },
    });
    const renderP = parseToolResult(render.body);
    console.log(`  Version: ${renderP.version}, Bricks: ${brickCount(renderP)}`);
    assert(brickCount(renderP) === 3, `Expected 3 bricks, got ${brickCount(renderP)} — STATE LOST!`);
    console.log("  ✓ PASS\n");

    // Add bricks one at a time
    console.log("Test 4: Add single brick");
    const add1 = await mcpRequest({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "brick_add", arguments: { typeId: "brick_1x1", x: 10, y: 0, z: 10, color: "#ffd700" } },
    });
    const add1P = parseToolResult(add1.body);
    console.log(`  Version: ${add1P.version}, Bricks: ${brickCount(add1P)}`);
    assert(brickCount(add1P) === 4, `Expected 4 bricks, got ${brickCount(add1P)}`);
    console.log("  ✓ PASS\n");

    console.log("Test 5: Add another brick (both must persist)");
    const add2 = await mcpRequest({
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "brick_add", arguments: { typeId: "brick_1x1", x: 12, y: 0, z: 10, color: "#ffd700" } },
    });
    const add2P = parseToolResult(add2.body);
    console.log(`  Version: ${add2P.version}, Bricks: ${brickCount(add2P)}`);
    assert(brickCount(add2P) === 5, `Expected 5 bricks, got ${brickCount(add2P)}`);
    console.log("  ✓ PASS\n");

    // Poll
    console.log("Test 6: Poll with old version");
    const poll = await mcpRequest({
      jsonrpc: "2.0", id: 6, method: "tools/call",
      params: { name: "brick_poll_scene", arguments: { knownVersion: 0 } },
    });
    const pollP = parseToolResult(poll.body);
    console.log(`  Version: ${pollP.version}, Bricks: ${brickCount(pollP)}`);
    assert(brickCount(pollP) === 5, `Expected 5 bricks, got ${brickCount(pollP)}`);
    console.log("  ✓ PASS\n");

    // Clear
    console.log("Test 7: Clear scene and rebuild");
    await mcpRequest({
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "brick_clear_scene", arguments: {} },
    });
    const rebuild = await mcpRequest({
      jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "brick_build_structure", arguments: {
        bricks: [{ typeId: "brick_2x4", x: 5, y: 0, z: 5, color: "#cc0000" }],
      }},
    });
    const rebuildP = parseToolResult(rebuild.body);
    console.log(`  Version: ${rebuildP.version}, Bricks: ${brickCount(rebuildP)}`);
    assert(brickCount(rebuildP) === 1, `Expected 1 brick, got ${brickCount(rebuildP)}`);
    console.log("  ✓ PASS\n");

    // Get scene
    console.log("Test 8: Get scene (verify state after clear+rebuild)");
    const getScene = await mcpRequest({
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "brick_get_scene", arguments: {} },
    });
    const getP = parseToolResult(getScene.body);
    console.log(`  Version: ${getP.version}, Bricks: ${brickCount(getP)}`);
    assert(brickCount(getP) === 1, `Expected 1 brick, got ${brickCount(getP)}`);
    console.log("  ✓ PASS\n");

    console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      console.log("\n⚠️  SOME TESTS FAILED — state is not persisting across requests!");
    } else {
      console.log("\n✅ All tests passed — state persists correctly across HTTP requests.");
    }
  } catch (e) {
    console.error("\nTEST ERROR:", e);
    failed++;
  }

  serverProc.kill("SIGTERM");
  process.exit(failed > 0 ? 1 : 0);
}

main();
