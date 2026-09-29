// `make style`: escribe BUILD_DIR/style/veni-<variante>-<idioma>.json.
//
// Lee del entorno (el Makefile exporta los valores de config/region.yml y fija
// los valores por defecto; aquí no se repiten):
//   REGION_NAME, REGION_CENTER ("lon,lat"), REGION_ZOOM
//   STYLE_BASE_URL  URL absoluta donde se publican PMTiles, glyphs y sprites
//   STYLE_VERSION   versión que queda en los metadatos
//   BUILD_DIR       carpeta de salida
//
// Los cuatro archivos se preparan en una carpeta temporal y reemplazan a los
// anteriores con dos renombres, igual que extract.sh y assets.sh: si algo
// falla, queda la salida anterior completa.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildStyle,
  LANGS,
  normalizeBaseUrl,
  parseCenter,
  parseRegionName,
  parseZoom,
  VARIANTS,
} from "./style.ts";

function fail(message: string): never {
  console.error(`build.ts: ${message}`);
  process.exit(1);
}

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") fail(`falta ${name} (usá make style)`);
  return value;
}

function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const buildDir = env("BUILD_DIR");
const region = parse(() => parseRegionName(env("REGION_NAME")));
const center = parse(() => parseCenter(env("REGION_CENTER")));
const zoom = parse(() => parseZoom(env("REGION_ZOOM")));
const baseUrl = parse(() => normalizeBaseUrl(env("STYLE_BASE_URL")));
const version = env("STYLE_VERSION");

// Procedencia del extracto: build/build.json lo escribe `make extract`.
const buildJson = join(buildDir, "build.json");
const protomapsBuild = existsSync(buildJson)
  ? String((JSON.parse(readFileSync(buildJson, "utf8")) as { protomaps_build?: string }).protomaps_build ?? "desconocida")
  : "desconocida";

const out = join(buildDir, "style");
const old = `${out}.old`;
mkdirSync(buildDir, { recursive: true });
const staging = mkdtempSync(join(buildDir, ".style."));

try {
  for (const variant of VARIANTS) {
    for (const lang of LANGS) {
      const style = buildStyle({ variant, lang, baseUrl, region, center, zoom, version, protomapsBuild });
      const file = `veni-${variant}-${lang}.json`;
      writeFileSync(join(staging, file), `${JSON.stringify(style, null, 2)}\n`);
      console.log(`==> ${file} (${style.layers.length} capas)`);
    }
  }
  // mkdtemp crea la carpeta con 0700: un servidor con otro usuario no podría leerla.
  chmodSync(staging, 0o755);

  rmSync(old, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, old);
  try {
    renameSync(staging, out);
  } catch (error) {
    if (existsSync(old) && !existsSync(out)) renameSync(old, out);
    throw error;
  }
  try {
    rmSync(old, { recursive: true, force: true });
  } catch {
    console.error(`build.ts: aviso: no se pudo borrar ${old}; borralo a mano`);
  }
} catch (error) {
  rmSync(staging, { recursive: true, force: true });
  fail(error instanceof Error ? error.message : String(error));
}

console.log(`==> Listo: ${out} (base ${baseUrl}, versión ${version}, build de Protomaps ${protomapsBuild})`);
