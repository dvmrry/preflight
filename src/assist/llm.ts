// The only door to a language model. Everything model-made in this tool comes through `structured()`: one chat call to
// an OpenAI-compatible endpoint with a strict JSON schema, parsed and re-validated here. Model output never becomes a
// blocking finding; the assist commands label it and leave the decision to a person.
//
// Configure with PREFLIGHT_LLM_URL (base URL, e.g. http://host:8731), PREFLIGHT_LLM_MODEL, optional
// PREFLIGHT_LLM_KEY (bearer) and PREFLIGHT_LLM_EFFORT (reasoning_effort hint, e.g. "medium").
// PREFLIGHT_LLM_URL=claude-code runs the model through the Claude Code CLI instead (`claude -p`, MODEL e.g. "haiku"):
// structured output via --json-schema, images read with its Read tool, no other tools.

export interface LlmConfig { url: string; model: string; key?: string; effort?: string; timeoutS?: number }

export function llmFromEnv(env = process.env): LlmConfig {
  const url = env.PREFLIGHT_LLM_URL, model = env.PREFLIGHT_LLM_MODEL;
  if (url === "claude-code") return { url, model: model ?? "haiku", effort: env.PREFLIGHT_LLM_EFFORT, timeoutS: Number(env.PREFLIGHT_LLM_TIMEOUT_S ?? 900) };
  if (!url || !model) throw new Error("set PREFLIGHT_LLM_URL and PREFLIGHT_LLM_MODEL (any OpenAI-compatible endpoint)");
  return { url: url.replace(/\/+$/, ""), model, key: env.PREFLIGHT_LLM_KEY, effort: env.PREFLIGHT_LLM_EFFORT, timeoutS: Number(env.PREFLIGHT_LLM_TIMEOUT_S ?? 900) };
}

export interface Usage { calls: number; promptTokens: number; completionTokens: number; seconds: number; costUsd?: number }
export const usage: Usage = { calls: 0, promptTokens: 0, completionTokens: 0, seconds: 0 };

export interface StructuredOpts { system: string; user: string; name: string; schema: object; maxTokens?: number; images?: string[] }

export async function structured<T>(cfg: LlmConfig, opts: StructuredOpts): Promise<T> {
  if (cfg.url === "claude-code") return viaClaudeCode<T>(cfg, opts);
  if (opts.images?.length) {
    const { readFileSync } = await import("node:fs");
    const parts: unknown[] = [{ type: "text", text: opts.user }];
    for (const p of opts.images) parts.push({ type: "image_url", image_url: { url: `data:${p.endsWith(".png") ? "image/png" : "image/jpeg"};base64,${readFileSync(p).toString("base64")}` } });
    (opts as { userParts?: unknown[] }).userParts = parts;
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    temperature: 0.2,
    max_tokens: opts.maxTokens ?? 8000,
    messages: [{ role: "system", content: opts.system }, { role: "user", content: (opts as { userParts?: unknown[] }).userParts ?? opts.user }],
    response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
  };
  if (cfg.effort) body.reasoning_effort = cfg.effort;
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    const r = await fetch(`${cfg.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((cfg.timeoutS ?? 900) * 1000),
    });
    if (!r.ok) throw new Error(`model endpoint ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    usage.calls++; usage.seconds += (Date.now() - t0) / 1000;
    usage.promptTokens += j.usage?.prompt_tokens ?? 0; usage.completionTokens += j.usage?.completion_tokens ?? 0;
    const text = j.choices?.[0]?.message?.content ?? "";
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      lastErr = `${(e as Error).message}; got: ${text.slice(0, 200)}`; // truncated or malformed: one retry
    }
  }
  throw new Error(`model returned no valid JSON for ${opts.name}: ${lastErr}`);
}

// Claude Code as the model: `claude -p` with a JSON schema; images are files it reads with its Read tool (nothing else is
// allowed). Runs in the images' folder so it can see them.
async function viaClaudeCode<T>(cfg: LlmConfig, opts: StructuredOpts): Promise<T> {
  const { spawn } = await import("node:child_process");
  const { dirname, basename } = await import("node:path");
  const dir = opts.images?.length ? dirname(opts.images[0]) : process.cwd();
  const prompt = `${opts.system}\n\n${opts.user}${opts.images?.length ? `\n\nImages (in the current folder; open each with the Read tool before answering): ${opts.images.map((p) => basename(p)).join(", ")}` : ""}`;
  const args = ["-p", "--model", cfg.model, "--output-format", "json", "--json-schema", JSON.stringify(opts.schema), "--allowedTools", "Read",
    "--disallowedTools", "Bash", "Write", "Edit", "WebFetch", "WebSearch", "Agent"];
  if (cfg.effort) args.push("--effort", cfg.effort);
  const t0 = Date.now();
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn("claude", args, { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let o = "", e = "";
    p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), (cfg.timeoutS ?? 900) * 1000);
    p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(o) : reject(new Error(`claude exited ${code}: ${e.slice(0, 300)}`)); });
    p.stdin.end(prompt);
  });
  const j = JSON.parse(out) as { structured_output?: T; is_error?: boolean; result?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } };
  usage.calls++; usage.seconds += (Date.now() - t0) / 1000;
  usage.promptTokens += j.usage?.input_tokens ?? 0; usage.completionTokens += j.usage?.output_tokens ?? 0;
  usage.costUsd = (usage.costUsd ?? 0) + (j.total_cost_usd ?? 0);
  if (j.is_error || !j.structured_output) throw new Error(`claude returned no structured output: ${String(j.result).slice(0, 200)}`);
  return j.structured_output;
}

export function usageLine(): string {
  return `model: ${usage.calls} calls, ${usage.promptTokens} in + ${usage.completionTokens} out tokens, ${usage.seconds.toFixed(0)} s${usage.costUsd ? `, $${usage.costUsd.toFixed(4)}` : ""}`;
}
