// Builds the static web demo into site/ (for GitHub Pages): the pure checker bundled for the browser (node:zlib swapped
// for the pure-JS inflate), the page, the public example guidelines and brand profiles, and a small demo file set.
// Run: bun tools/web/build.ts
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadBrand } from "../../src/io.ts";

const root = new URL("../..", import.meta.url).pathname, site = join(root, "site");
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, "data"), { recursive: true });
mkdirSync(join(site, "demo"), { recursive: true });

const r = await Bun.build({
  entrypoints: [join(root, "src/web/app.ts")], outdir: site, target: "browser", minify: true, naming: "app.js",
  plugins: [{ name: "browser-inflate", setup(b) { b.onResolve({ filter: /\/inflate\.ts$/ }, () => ({ path: join(root, "src/formats/inflate.browser.ts") })); } }],
});
if (!r.success) { console.error(r.logs.join("\n")); process.exit(1); }
cpSync(join(root, "tools/web/index.html"), join(site, "index.html"));
writeFileSync(join(site, ".nojekyll"), "");

// Public data only: guidelines and brands listed here (private kits are never published).
const PUBLIC_GUIDELINES = ["acme-spring.json", "streaming-delivery.json"];
const PUBLIC_BRANDS = ["tunewell"];
for (const g of PUBLIC_GUIDELINES) cpSync(join(root, "examples/projects", g), join(site, "data", g));
for (const b of PUBLIC_BRANDS) writeFileSync(join(site, "data", `brand-${b}.json`), JSON.stringify(loadBrand(join(root, "examples/brands", b, "brand.jsonc"))));
writeFileSync(join(site, "data/index.json"), JSON.stringify({ guidelines: PUBLIC_GUIDELINES, brands: PUBLIC_BRANDS.map((b) => `brand-${b}.json`) }));

// Demo files: the dummy Acme spring launch set (images, one video, the Figma file).
const ex = join(root, "examples/spring-launch/exports");
const demo = readdirSync(ex).filter((f) => !f.startsWith(".") && (/\.(png|jpe?g)$/i.test(f) || f === "acme-spring_ig-story_v1.mp4"));
for (const f of demo) cpSync(join(ex, f), join(site, "demo", f));
cpSync(join(root, "examples/spring-launch/campaign.figma.json"), join(site, "demo/campaign.figma.json"));
writeFileSync(join(site, "demo/index.json"), JSON.stringify([...demo, "campaign.figma.json"]));

const size = (p: string): number => statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size;
console.log(`site/ built: app.js ${(statSync(join(site, "app.js")).size / 1024).toFixed(0)} KB, total ${(size(site) / 1048576).toFixed(1)} MB`);
