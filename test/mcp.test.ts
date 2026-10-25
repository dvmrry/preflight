import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHandler, serve } from "../src/mcp.ts";

const EX = new URL("../examples/", import.meta.url).pathname;
const handle = makeHandler({ projectsDir: EX + "projects", assetRoot: EX });
let id = 0;
const rpc = (method: string, params?: object) => handle({ jsonrpc: "2.0", id: ++id, method, params }) as Promise<any>;
const tool = async (name: string, args: object) => (await rpc("tools/call", { name, arguments: args })).result;

test("handshake and tool list", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.equal(init.result.serverInfo.name, "preflight");
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
  const names = (await rpc("tools/list")).result.tools.map((t: any) => t.name);
  assert.deepEqual(names, ["check_figma", "check_urls", "check_folder", "validate_guidelines", "list_projects"]);
});

test("check_folder by stored project name returns the same report as the CLI", async () => {
  const r = await tool("check_folder", { path: "spring-launch/exports", guidelines: "acme-spring" });
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.summary.assets, 9);
  assert.equal(r.structuredContent.summary.errors, 10);
});

test("check_figma with inline guidelines", async () => {
  const r = await tool("check_figma", { figma: "spring-launch/campaign.figma.json", guidelines: { project: "inline", brand: { fonts: ["Inter"] } } });
  const rules = r.structuredContent.assets.flatMap((a: any) => a.findings.map((f: any) => f.rule));
  assert.ok(rules.includes("brand.font")); // Recoleta and Helvetica are both off-brand under these guidelines
});

test("errors come back as tool results the model can read; paths can't escape the roots", async () => {
  const bad = await tool("check_figma", { figma: "x", guidelines: { project: "p", brand: { palette: ["red"] } } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /not #RRGGBB/);
  assert.equal((await tool("check_folder", { path: "../../", guidelines: "acme-spring" })).isError, true);
  assert.match((await tool("check_figma", { figma: "/etc/hosts.figma.json", guidelines: "acme-spring" })).content[0].text, /outside the asset root/);
  assert.equal((await tool("check_folder", { path: "spring-launch", guidelines: "../../etc/passwd" })).isError, true);
  assert.equal((await rpc("nope")).error.code, -32601);
});

test("HTTP: token required, JSON in and out", async () => {
  const server = serve({ port: 0, host: "127.0.0.1", projectsDir: EX + "projects", token: "s3cret" });
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
  const post = (auth?: string) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } }) });
  try {
    assert.equal((await post()).status, 401);
    const ok = await post("Bearer s3cret");
    assert.ok((await ok.json()).result.structuredContent.projects.includes("acme-spring"));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
