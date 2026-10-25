#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { validateGuidelines } from "./guidelines.ts";
import { loadGuidelines } from "./io.ts";
import { VERSION, buildReport, checkFigma, checkFile } from "./run.ts";
import { checkSources } from "./core.ts";
import type { AssetReport, Guidelines } from "./types.ts";

// EXPERIMENTAL — not hardened for exposure (no SSRF filtering on check_urls, synchronous checks, no rate limits).
// Run it on localhost for testing only. The supported path is the CLI.
//
// MCP server over Streamable HTTP (stateless: every POST is one JSON-RPC message answered with plain JSON, which the
// spec allows), so a hosted agent platform like Dust can add it as a remote tool server. Zero dependencies on
// purpose: whoever deploys it needs only Node (or Bun), plus ffmpeg for video.
//
// The tools return the full JSON report. The agent's job is to rank, group and explain; the measuring is done here.

const PROTOCOL = "2025-06-18";

const guidelinesArg = {
  description: "The project's guidelines: either the name of a guidelines file on this server (see list_projects) or the guidelines object itself.",
  oneOf: [{ type: "string" }, { type: "object" }],
};

const TOOLS = [
  {
    name: "check_figma",
    description: "Check every top-level frame of a Figma file against the project guidelines: frame sizes, off-palette colours, fonts, text size, text contrast, unstyled text. Returns a JSON report of findings with measured and expected values.",
    inputSchema: { type: "object", properties: { figma: { type: "string", description: "A figma.com/design/... link, figma:FILEKEY, or a saved Figma API response (*.figma.json) relative to the server's asset root" }, guidelines: guidelinesArg }, required: ["figma", "guidelines"] },
  },
  {
    name: "check_urls",
    description: "Download exported assets (images, videos) from URLs and check them against the project guidelines: dimensions, format, file size, colour profile and mode, transparency, frame rate, codec, duration, loudness, black frames, naming. Returns a JSON report.",
    inputSchema: { type: "object", properties: { urls: { type: "array", items: { type: "string" }, maxItems: 50 }, guidelines: guidelinesArg }, required: ["urls", "guidelines"] },
  },
  {
    name: "check_folder",
    description: "Check exported assets in a folder this server can read (a shared drive or sync folder), against the project guidelines. Returns a JSON report.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Folder or file, relative to the server's asset root" }, guidelines: guidelinesArg }, required: ["path", "guidelines"] },
  },
  {
    name: "validate_guidelines",
    description: "Check a guidelines object for mistakes (unknown keys, bad colours, bad regex) before using it. Returns a list of problems; empty means valid.",
    inputSchema: { type: "object", properties: { guidelines: { type: "object" } }, required: ["guidelines"] },
  },
  {
    name: "list_projects",
    description: "List the guidelines files stored on this server.",
    inputSchema: { type: "object", properties: {} },
  },
];

export interface ServerOptions { projectsDir: string; assetRoot?: string; token?: string }

export function makeHandler(opts: ServerOptions) {
  const resolveGuidelines = (g: unknown): Guidelines => {
    if (typeof g === "object" && g !== null) {
      const problems = validateGuidelines(g);
      if (problems.length) throw new Error(`guidelines:\n  ${problems.join("\n  ")}`);
      return g as Guidelines;
    }
    const name = basename(String(g)).replace(/\.json$/, "") + ".json"; // no paths out of the projects folder
    return loadGuidelines(join(opts.projectsDir, name));
  };

  // Anything read from this server's disk must sit under the asset root.
  const inAssets = (p: string): string => {
    if (!opts.assetRoot) throw new Error("this server has no asset root configured (--assets)");
    const root = resolve(opts.assetRoot);
    const target = resolve(root, p);
    if (target !== root && !target.startsWith(root + "/")) throw new Error("path is outside the asset root");
    return target;
  };

  const call = async (name: string, a: any): Promise<unknown> => {
    switch (name) {
      case "validate_guidelines":
        return { problems: validateGuidelines(a.guidelines) };
      case "list_projects": {
        const { readdirSync } = await import("node:fs");
        return { projects: existsSync(opts.projectsDir) ? readdirSync(opts.projectsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [] };
      }
      case "check_figma": {
        const g = resolveGuidelines(a.guidelines);
        const src = /^figma:|figma\.com\//.test(a.figma) ? a.figma : inAssets(a.figma);
        return buildReport(g, await checkFigma(g, src));
      }
      case "check_folder": {
        const target = inAssets(a.path);
        const g = resolveGuidelines(a.guidelines);
        return buildReport(g, await checkSources(g, [target]));
      }
      case "check_urls": {
        const g = resolveGuidelines(a.guidelines);
        const dir = mkdtempSync(join(tmpdir(), "preflight-"));
        try {
          const reports: AssetReport[] = [];
          for (const u of a.urls as string[]) {
            const r = await fetch(u);
            if (!r.ok) throw new Error(`download ${u}: HTTP ${r.status}`);
            // The remote name is only used for the naming check; on disk the file gets a name we choose.
            const remote = basename(decodeURIComponent(new URL(u).pathname)).replace(/[\/\\\0]/g, "_") || "asset";
            const sub = join(dir, String(reports.length));
            mkdirSync(sub);
            const file = join(sub, remote === "." || remote === ".." ? "asset" : remote);
            writeFileSync(file, Buffer.from(await r.arrayBuffer()));
            const rep = await checkFile(g, file);
            for (const f of rep.findings) f.asset = u;
            reports.push({ ...rep, asset: u });
          }
          return buildReport(g, reports);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    throw new RpcError(-32602, `unknown tool ${name}`);
  };

  // One JSON-RPC message in, one out (or none for notifications).
  return async (msg: any): Promise<object | undefined> => {
    if (typeof msg !== "object" || msg === null || typeof msg.method !== "string") {
      if (msg && typeof msg === "object" && "id" in msg && ("result" in msg || "error" in msg)) return undefined; // a client's response
      return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "invalid request" } };
    }
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    if (msg.id === undefined) return undefined; // notifications/initialized and friends
    try {
      switch (msg.method) {
        case "initialize":
          return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "preflight", version: VERSION } });
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: TOOLS });
        case "tools/call":
          try {
            const out = await call(msg.params?.name, msg.params?.arguments ?? {});
            return reply({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false });
          } catch (e) {
            if (e instanceof RpcError) throw e;
            // Tool failures go back to the model as a result it can read and act on, per the MCP spec.
            return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true });
          }
        default:
          throw new RpcError(-32601, `method not found: ${msg.method}`);
      }
    } catch (e) {
      const err = e instanceof RpcError ? e : new RpcError(-32603, (e as Error).message);
      return { jsonrpc: "2.0", id: msg.id, error: { code: err.code, message: err.message } };
    }
  };
}

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

export function serve(opts: ServerOptions & { port: number; host: string }) {
  const handle = makeHandler(opts);
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body?: object) => {
      res.writeHead(status, body ? { "content-type": "application/json" } : {});
      res.end(body ? JSON.stringify(body) : undefined);
    };
    if (req.url?.split("?")[0] !== "/mcp") return send(404, { error: "the MCP endpoint is /mcp" });
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return send(401, { error: "unauthorized" });
    if (req.method === "GET") return send(405); // no server-initiated stream in stateless mode
    if (req.method !== "POST") return send(405);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1 << 20) return send(413, { error: "request too large" });
        chunks.push(chunk);
      }
      let msg: any;
      try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
      if (Array.isArray(msg)) return send(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "batches are not supported" } });
      const out = await handle(msg);
      return out ? send(200, out) : send(202);
    } catch (e) {
      if (!res.headersSent) send(500, { error: (e as Error).message }); // a dropped connection or a bug: never take the process down
    }
  });
  server.listen(opts.port, opts.host);
  return server;
}

if (import.meta.main ?? process.argv[1]?.endsWith("mcp.ts")) {
  const { values } = parseArgs({ options: {
    port: { type: "string", default: "8790" }, host: { type: "string", default: "127.0.0.1" },
    projects: { type: "string", default: "projects" }, assets: { type: "string" },
  } });
  const token = process.env.PREFLIGHT_TOKEN;
  if (values.host !== "127.0.0.1" && !token) {
    console.error("refusing to listen beyond localhost without PREFLIGHT_TOKEN set");
    process.exit(2);
  }
  serve({ port: +values.port!, host: values.host!, projectsDir: values.projects!, assetRoot: values.assets, token });
  console.error(`preflight MCP on http://${values.host}:${values.port}/mcp (projects: ${values.projects}${values.assets ? `, assets: ${values.assets}` : ""})`);
}
