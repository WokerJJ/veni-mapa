// Reporte de la actualización mensual del extracto (update.yml).
//
//   node scripts/update-report.ts --build build/build.json --pmtiles build/roldanillo.pmtiles \
//     --data data/build.json --report build/update-report.md \
//     [--previous-manifest anterior/manifest.json --previous-pmtiles anterior/roldanillo.pmtiles]
//
// Escribe data/build.json (build de Protomaps, tamaño, SHA-256 y tiles por zoom
// del extracto nuevo: el diff del PR) y un reporte en Markdown que lo compara
// con la última release. Sin release anterior, el reporte lo dice.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fileTileStats } from "./tile-stats.ts";

export interface Snapshot {
  region: string;
  protomaps_build: string;
  bytes: number;
  sha256: string;
  tiles: number;
  tiles_by_zoom: Record<string, number>;
}

export interface Previous {
  version: string;
  snapshot: Snapshot;
}

const BUILD = /^[0-9]{8}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// 20261003 -> 2026-10-03
export function isoDate(build: string): string {
  if (!BUILD.test(build)) throw new Error(`build de Protomaps inválida: '${build}'`);
  return `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6)}`;
}

function number(n: number): string {
  // Separador de miles con punto, como se escribe en Colombia, sin depender de ICU.
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(2).replace(".", ",")} MB`;
}

function signed(n: number): string {
  return n > 0 ? `+${number(n)}` : n < 0 ? `−${number(-n)}` : "0";
}

function percent(before: number, after: number): string {
  if (before === 0) return "";
  const p = ((after - before) / before) * 100;
  const text = Math.abs(p).toFixed(1).replace(".", ",");
  return p > 0 ? ` (+${text} %)` : p < 0 ? ` (−${text} %)` : " (0 %)";
}

// deps y no chore: release-please solo abre un PR de release con tipos visibles
// en el CHANGELOG (release-please-config.json), y la app consume releases. Al
// fusionar la actualización sale una versión de parche con los datos nuevos.
export function title(next: Snapshot): string {
  return `deps(datos): actualizar extracto de OSM a ${isoDate(next.protomaps_build)}`;
}

export function report(next: Snapshot, previous: Previous | null): string {
  const lines: string[] = [];
  lines.push(`Extracto de **${next.region}** regenerado desde la build de Protomaps del **${isoDate(next.protomaps_build)}**.`, "");
  if (!previous) {
    lines.push("No hay release anterior con la que comparar.", "");
    lines.push("| | Nuevo |", "| --- | --- |");
    lines.push(`| Build de Protomaps | ${next.protomaps_build} |`);
    lines.push(`| Tamaño | ${megabytes(next.bytes)} (${number(next.bytes)} B) |`);
    lines.push(`| Tiles | ${number(next.tiles)} |`);
    lines.push(`| SHA-256 | \`${next.sha256}\` |`);
  } else {
    const prev = previous.snapshot;
    lines.push(`| | Release v${previous.version} | Nuevo | Cambio |`, "| --- | --- | --- | --- |");
    lines.push(`| Build de Protomaps | ${prev.protomaps_build} | ${next.protomaps_build} | |`);
    lines.push(
      `| Tamaño | ${megabytes(prev.bytes)} | ${megabytes(next.bytes)} | ${signed(next.bytes - prev.bytes)} B${percent(prev.bytes, next.bytes)} |`,
    );
    lines.push(`| Tiles | ${number(prev.tiles)} | ${number(next.tiles)} | ${signed(next.tiles - prev.tiles)} |`);
    lines.push(`| SHA-256 | \`${prev.sha256.slice(0, 12)}…\` | \`${next.sha256.slice(0, 12)}…\` | |`);
    if (prev.sha256 === next.sha256) lines.push("", "El extracto es idéntico al de la release (mismo SHA-256).");
  }

  lines.push("", "### Tiles por zoom", "");
  const zooms = [
    ...new Set([...Object.keys(next.tiles_by_zoom), ...Object.keys(previous?.snapshot.tiles_by_zoom ?? {})]),
  ].sort((a, b) => Number(a) - Number(b));
  if (previous) {
    lines.push("| Zoom | Release | Nuevo | Cambio |", "| ---: | ---: | ---: | ---: |");
    for (const z of zooms) {
      const before = previous.snapshot.tiles_by_zoom[z] ?? 0;
      const after = next.tiles_by_zoom[z] ?? 0;
      lines.push(`| ${z} | ${number(before)} | ${number(after)} | ${signed(after - before)} |`);
    }
  } else {
    lines.push("| Zoom | Tiles |", "| ---: | ---: |");
    for (const z of zooms) lines.push(`| ${z} | ${number(next.tiles_by_zoom[z] ?? 0)} |`);
  }

  lines.push(
    "",
    "Al fusionar, la próxima release usa esta build (`data/build.json`). Datos © colaboradores de OpenStreetMap (ODbL).",
    "",
  );
  return lines.join("\n");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function field<T>(object: Record<string, unknown>, key: string, check: (v: unknown) => v is T, source: string): T {
  const value = object[key];
  if (!check(value)) throw new Error(`${source}: campo '${key}' inválido`);
  return value;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

// Estado de un extracto. El SHA-256 se calcula del archivo y tiene que
// coincidir con el que declara su fuente (build.json o el manifest).
async function snapshot(meta: Record<string, unknown>, pmtiles: string, source: string, sha256: string, bytes: number) {
  const build = field(meta, "protomaps_build", isString, source);
  isoDate(build);
  const content = await readFile(pmtiles);
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== sha256 || content.length !== bytes) {
    throw new Error(`${pmtiles} no coincide con el SHA-256 o el tamaño de ${source}`);
  }
  const stats = await fileTileStats(pmtiles);
  return {
    region: field(meta, "region", isString, source),
    protomaps_build: build,
    bytes,
    sha256,
    tiles: stats.tiles,
    tiles_by_zoom: stats.by_zoom,
  } satisfies Snapshot;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      build: { type: "string" },
      pmtiles: { type: "string" },
      data: { type: "string" },
      report: { type: "string" },
      "previous-manifest": { type: "string" },
      "previous-pmtiles": { type: "string" },
    },
    strict: true,
  });
  const { build, pmtiles, data, report: reportPath } = values;
  if (!build || !pmtiles || !data || !reportPath) {
    throw new Error("faltan --build, --pmtiles, --data o --report");
  }
  if (!values["previous-manifest"] !== !values["previous-pmtiles"]) {
    throw new Error("--previous-manifest y --previous-pmtiles van juntos");
  }

  const buildJson = await readJson(build);
  const next = await snapshot(
    buildJson,
    pmtiles,
    build,
    field(buildJson, "sha256", isString, build),
    field(buildJson, "bytes", isCount, build),
  );

  let previous: Previous | null = null;
  if (values["previous-manifest"] && values["previous-pmtiles"]) {
    const source = values["previous-manifest"];
    const manifest = await readJson(source);
    const version = field(manifest, "version", isString, source);
    if (!VERSION.test(version)) throw new Error(`${source}: versión inválida '${version}'`);
    const name = field(manifest, "pmtiles", isString, source);
    const files = field(manifest, "files", Array.isArray, source) as { name?: unknown; sha256?: unknown; bytes?: unknown }[];
    const file = files.find((f) => f.name === name);
    if (!file || !isString(file.sha256) || !isCount(file.bytes)) throw new Error(`${source}: sin datos de ${name}`);
    previous = { version, snapshot: await snapshot(manifest, values["previous-pmtiles"], source, file.sha256, file.bytes) };
  }

  await writeFile(data, `${JSON.stringify(next, null, 2)}\n`);
  await writeFile(reportPath, report(next, previous));
  console.log(title(next));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(`update-report.ts: ${(error as Error).message}`);
    process.exit(1);
  });
}
