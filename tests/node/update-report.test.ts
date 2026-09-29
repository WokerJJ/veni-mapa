// Pruebas del reporte de la actualización mensual: formato y la CLI completa.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { promisify } from "node:util";
import { isoDate, report, title, type Snapshot } from "../../scripts/update-report.ts";
import { directory, pmtiles } from "./pmtiles-fixture.ts";

const run = promisify(execFile);

const next: Snapshot = {
  region: "roldanillo",
  protomaps_build: "20261003",
  bytes: 1_700_000,
  sha256: "b".repeat(64),
  tiles: 970,
  tiles_by_zoom: { "14": 197, "15": 680, "16": 1 },
};
const previous = {
  version: "0.1.0",
  snapshot: {
    region: "roldanillo",
    protomaps_build: "20260929",
    bytes: 1_652_451,
    sha256: "a".repeat(64),
    tiles: 961,
    tiles_by_zoom: { "13": 3, "14": 195, "15": 672 },
  },
};

describe("formato", () => {
  it("fecha ISO desde la build", () => {
    assert.equal(isoDate("20261003"), "2026-10-03");
    assert.throws(() => isoDate("2026-10-03"), /inválida/);
    assert.throws(() => isoDate("latest"), /inválida/);
  });

  it("título del PR", () => {
    assert.equal(title(next), "chore(datos): actualizar extracto de OSM a 2026-10-03");
  });

  it("compara con la release: build, tamaño, tiles y SHA-256", () => {
    const md = report(next, previous);
    assert.match(md, /\| Build de Protomaps \| 20260929 \| 20261003 \| \|/);
    assert.match(md, /\| Tamaño \| 1,65 MB \| 1,70 MB \| \+47\.549 B \(\+2,9 %\) \|/);
    assert.match(md, /\| Tiles \| 961 \| 970 \| \+9 \|/);
    assert.match(md, /`aaaaaaaaaaaa…` \| `bbbbbbbbbbbb…`/);
    assert.match(md, /Release v0\.1\.0/);
    assert.match(md, /© colaboradores de OpenStreetMap/);
  });

  it("tiles por zoom con los zooms de ambos lados, en orden numérico", () => {
    const md = report(next, previous);
    const rows = md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    assert.deepEqual(rows, ["| 13 | 3 | 0 | −3 |", "| 14 | 195 | 197 | +2 |", "| 15 | 672 | 680 | +8 |", "| 16 | 0 | 1 | +1 |"]);
  });

  it("sin release anterior lo dice y no inventa comparación", () => {
    const md = report(next, null);
    assert.match(md, /No hay release anterior/);
    assert.doesNotMatch(md, /Release v/);
    assert.match(md, /\| 16 \| 1 \|/);
  });

  it("avisa cuando el extracto es idéntico", () => {
    assert.match(report(previous.snapshot, previous), /idéntico al de la release/);
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "update-report-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  // Un PMTiles con 1 tile en z0 y 4 en z1, y otro con 1 en z0 y 2 en z1.
  const fileA = pmtiles(directory([{ tileId: 0, offset: 0, length: 1, runLength: 1 }, { tileId: 1, offset: 1, length: 1, runLength: 4 }]));
  const fileB = pmtiles(directory([{ tileId: 0, offset: 0, length: 1, runLength: 1 }, { tileId: 1, offset: 1, length: 1, runLength: 2 }]));
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  writeFileSync(join(dir, "nuevo.pmtiles"), fileA);
  writeFileSync(join(dir, "anterior.pmtiles"), fileB);
  const build = { region: "roldanillo", protomaps_build: "20261003", bytes: fileA.length, sha256: sha(fileA) };
  const manifest = {
    version: "0.1.0",
    region: "roldanillo",
    protomaps_build: "20260929",
    pmtiles: "roldanillo.pmtiles",
    files: [{ name: "roldanillo.pmtiles", bytes: fileB.length, sha256: sha(fileB) }],
  };

  const cli = (buildJson: object, extra: string[] = []) => {
    writeFileSync(join(dir, "build.json"), JSON.stringify(buildJson));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    return run(process.execPath, [
      "scripts/update-report.ts",
      "--build", join(dir, "build.json"),
      "--pmtiles", join(dir, "nuevo.pmtiles"),
      "--data", join(dir, "data.json"),
      "--report", join(dir, "reporte.md"),
      ...extra,
    ]);
  };
  const withPrevious = ["--previous-manifest", join(dir, "manifest.json"), "--previous-pmtiles", join(dir, "anterior.pmtiles")];

  it("escribe data/build.json y el reporte, e imprime el título", async () => {
    const { stdout } = await cli(build, withPrevious);
    assert.equal(stdout.trim(), "chore(datos): actualizar extracto de OSM a 2026-10-03");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "data.json"), "utf8")), {
      region: "roldanillo",
      protomaps_build: "20261003",
      bytes: fileA.length,
      sha256: sha(fileA),
      tiles: 5,
      tiles_by_zoom: { "0": 1, "1": 4 },
    });
    const md = readFileSync(join(dir, "reporte.md"), "utf8");
    assert.match(md, /\| Tiles \| 3 \| 5 \| \+2 \|/);
    assert.match(md, /\| 1 \| 2 \| 4 \| \+2 \|/);
  });

  it("sin release anterior", async () => {
    await cli(build);
    assert.match(readFileSync(join(dir, "reporte.md"), "utf8"), /No hay release anterior/);
  });

  it("rechaza un extracto que no coincide con build.json", async () => {
    await assert.rejects(cli({ ...build, sha256: "c".repeat(64) }), /no coincide con el SHA-256/);
  });

  it("rechaza un PMTiles anterior que no coincide con su manifest", async () => {
    writeFileSync(join(dir, "anterior.pmtiles"), fileA);
    try {
      await assert.rejects(cli(build, withPrevious), /anterior\.pmtiles no coincide/);
    } finally {
      writeFileSync(join(dir, "anterior.pmtiles"), fileB);
    }
  });

  it("rechaza una build inválida", async () => {
    await assert.rejects(cli({ ...build, protomaps_build: "latest" }), /build de Protomaps inválida/);
  });

  it("--previous-manifest sin --previous-pmtiles", async () => {
    await assert.rejects(cli(build, withPrevious.slice(0, 2)), /van juntos/);
  });
});
