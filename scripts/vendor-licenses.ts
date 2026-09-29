// Genera licenses/vendor-deps.txt: los avisos de licencia de todo lo que va
// empaquetado dentro de vendor/ (MapLibre GL y PMTiles) además de ellos mismos.
//
//   node scripts/vendor-licenses.ts          escribe el archivo
//   node scripts/vendor-licenses.ts --check  falla si el archivo no está al día
//
// Recorre las dependencias de producción, también las transitivas, tal como
// quedaron instaladas según package-lock.json. MIT, ISC y BSD exigen conservar
// el aviso en cada copia, y la demo se redistribuye en Pages.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["maplibre-gl", "pmtiles"];
// Solo tipos: no llegan al código empaquetado.
const TYPES_ONLY = /^@types\//;
const OUTPUT = "licenses/vendor-deps.txt";
const LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "license", "license.md", "LICENCE", "LICENSE-MIT"];

interface Manifest {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
}

function manifest(name: string): Manifest {
  const path = join("node_modules", name, "package.json");
  if (!existsSync(path)) throw new Error(`falta ${path}: corré npm ci`);
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

// Paquetes que declaran su licencia pero no traen el archivo: el texto se toma
// del repositorio de origen y se guarda en licenses/overrides/<paquete>.txt.
const OVERRIDES = "licenses/overrides";

function licenseText(name: string): string {
  const override = join(OVERRIDES, `${name.replaceAll("/", "__")}.txt`);
  if (existsSync(override)) return readFileSync(override, "utf8").trim();
  for (const file of LICENSE_FILES) {
    const path = join("node_modules", name, file);
    if (existsSync(path)) return readFileSync(path, "utf8").trim();
  }
  throw new Error(`${name} no trae archivo de licencia; agregá el texto en ${OVERRIDES}/`);
}

const seen = new Map<string, Manifest>();
const pending = ROOTS.flatMap((root) => Object.keys(manifest(root).dependencies ?? {}));
while (pending.length > 0) {
  const name = pending.shift()!;
  if (seen.has(name) || TYPES_ONLY.test(name)) continue;
  const info = manifest(name);
  seen.set(name, info);
  pending.push(...Object.keys(info.dependencies ?? {}));
}

const sections = [...seen.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((info) => `${"=".repeat(78)}\n${info.name}@${info.version} (${info.license ?? "sin campo license"})\n${"=".repeat(78)}\n\n${licenseText(info.name)}\n`);

const content = [
  "Avisos de licencia del código de terceros empaquetado en vendor/ (demo).",
  `Dependencias de ${ROOTS.join(" y ")}, generado por scripts/vendor-licenses.ts. No editar.`,
  "Las licencias de maplibre-gl y pmtiles están en maplibre-gl-BSD-3.txt y pmtiles-BSD-3.txt.",
  "",
  ...sections,
].join("\n");

if (process.argv.includes("--check")) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== content) {
    console.error(`vendor-licenses.ts: ${OUTPUT} no está al día; corré make licenses`);
    process.exit(1);
  }
  console.log(`==> ${OUTPUT} al día (${seen.size} paquetes)`);
} else {
  writeFileSync(OUTPUT, content);
  console.log(`==> ${OUTPUT} (${seen.size} paquetes)`);
}
