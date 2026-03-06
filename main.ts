import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { createServer } from "./server.js";

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export async function startStreamableHTTPServer(
  createServer: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  // Session map: maintains one server per session so state persists across requests
  const sessions = new Map<string, Session>();

  // Serve the test harness at /test (dev convenience)
  app.get("/test", (_req: Request, res: Response) => {
    const harnessPath = path.resolve(
      import.meta.dirname,
      import.meta.filename.endsWith(".ts") ? "." : "..",
      "test-harness.html",
    );
    if (fs.existsSync(harnessPath)) {
      res.type("html").send(fs.readFileSync(harnessPath, "utf-8"));
    } else {
      res.status(404).send("test-harness.html not found");
    }
  });

  // Serve LDraw library files for test harness
  const ldrawDir = path.resolve(
    import.meta.dirname,
    import.meta.filename.endsWith(".ts") ? "." : "..",
    "ldraw",
  );
  if (fs.existsSync(ldrawDir)) {
    app.use("/ldraw", express.static(ldrawDir));
  }

  app.all("/mcp", async (req: Request, res: Response) => {
    // Prevent reverse-proxy buffering (Cloudflare Tunnels, Nginx, etc.)
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    // Check for existing session via header
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session — state persists
      const session = sessions.get(sessionId)!;
      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("MCP error (existing session):", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
      return;
    }

    // Session ID was provided but not found — reject with 404 per MCP spec
    if (sessionId) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      });
      return;
    }

    // New session: create a fresh server + stateful transport
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    // Clean up session when transport closes
    // NOTE: Do NOT call server.close() here — it calls transport.close()
    // which fires onclose again, causing infinite recursion / stack overflow.
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
      }
    };

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Store session for future requests
      const sid = transport.sessionId;
      if (sid) {
        sessions.set(sid, { server, transport });
      }
    } catch (error) {
      console.error("MCP error (new session):", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(`Brick Builder MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    // Close servers (which close their transports via protocol.close())
    // Don't call transport.close() separately — server.close() does it.
    for (const [, session] of sessions) {
      session.server.close().catch(() => {});
    }
    sessions.clear();
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(
  createServer: () => McpServer,
): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
