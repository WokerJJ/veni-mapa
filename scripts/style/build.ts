// `make style`: escribe BUILD_DIR/style/veni-<variante>-<idioma>.json.
//
// Lee del entorno (el Makefile exporta los valores de config/region.yml):
//   REGION_NAME, REGION_CENTER ("lon,lat"), REGION_ZOOM
//   STYLE_BASE_URL  URL absoluta donde se publican PMTiles, glyphs y sprites
//   BUILD_DIR       carpeta de salida (por defecto, build)
//
// Los cuatro archivos se preparan en una carpeta temporal y reemplazan a los
// anteriores de una vez, igual que extract.sh y assets.sh.
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildStyle, LANGS, VARIANTS } from "./style.ts";

function fail(message: string): never {
  console.error(`build.ts: ${message}`);
  process.exit(1);
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") fail(`falta ${name} (usá make style)`);
  return value;
}

function parseCenter(raw: string): [number, number] {
  const parts = raw.split(",").map(Number);
  const [lon, lat] = parts;
  if (parts.length !== 2 || lon === undefined || lat === undefined || !parts.every(Number.isFinite)) {
    fail(`REGION_CENTER debe ser "lon,lat" (recibido: '${raw}')`);
  }
  return [lon, lat];
}

const buildDir = env("BUILD_DIR", "build");
const region = env("REGION_NAME");
const center = parseCenter(env("REGION_CENTER"));
const zoom = Number(env("REGION_ZOOM"));
if (!Number.isFinite(zoom)) fail(`REGION_ZOOM debe ser un número (recibido: '${process.env.REGION_ZOOM}')`);
const baseUrl = env("STYLE_BASE_URL", "http://localhost:8080");
const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };

const out = join(buildDir, "style");
mkdirSync(buildDir, { recursive: true });
const staging = mkdtempSync(join(buildDir, ".style."));

try {
  for (const variant of VARIANTS) {
    for (const lang of LANGS) {
      const style = buildStyle({ variant, lang, baseUrl, region, center, zoom, version: version ?? "0.0.0" });
      const file = `veni-${variant}-${lang}.json`;
      writeFileSync(join(staging, file), `${JSON.stringify(style, null, 2)}\n`);
      console.log(`==> ${file} (${style.layers.length} capas)`);
    }
  }
  rmSync(out, { recursive: true, force: true });
  renameSync(staging, out);
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : String(error));
}

console.log(`==> Listo: ${out} (base ${baseUrl})`);
