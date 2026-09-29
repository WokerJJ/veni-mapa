// Pruebas del conteo de tiles por zoom con PMTiles v3 mínimos armados aquí.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { fileTileStats, parseDirectory, zoomOf } from "../../scripts/tile-stats.ts";
import { directory, pmtiles, type TestEntry } from "./pmtiles-fixture.ts";

const dir = mkdtempSync(join(tmpdir(), "tile-stats-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
function write(bytes: Uint8Array): string {
  const path = join(dir, `t${n++}.pmtiles`);
  writeFileSync(path, bytes);
  return path;
}

// z0 (ID 0), los 4 tiles de z1 (IDs 1-4) y 3 tiles repetidos de z2 (IDs 5-7).
const entries: TestEntry[] = [
  { tileId: 0, offset: 0, length: 10, runLength: 1 },
  { tileId: 1, offset: 10, length: 10, runLength: 4 },
  { tileId: 5, offset: 20, length: 10, runLength: 3 },
];
const expected = { tiles: 8, by_zoom: { "0": 1, "1": 4, "2": 3 } };

describe("zoomOf", () => {
  for (const [id, z] of [[0, 0], [1, 1], [4, 1], [5, 2], [20, 2], [21, 3], [84, 3], [85, 4]] as const) {
    it(`ID ${id} es de z${z}`, () => assert.equal(zoomOf(id), z));
  }
  it("z15 de Roldanillo", () => {
    // ID del primer tile de z15: (4^15 - 1) / 3.
    assert.equal(zoomOf((4 ** 15 - 1) / 3), 15);
    assert.equal(zoomOf((4 ** 15 - 1) / 3 - 1), 14);
  });
});

describe("parseDirectory", () => {
  it("offset 0 significa contiguo al anterior", () => {
    const bytes = Uint8Array.from([2, 0, 1, 1, 1, 5, 7, 1, 0]);
    assert.deepEqual(parseDirectory(bytes), [
      { tileId: 0, offset: 0, length: 5, runLength: 1 },
      { tileId: 1, offset: 5, length: 7, runLength: 1 },
    ]);
  });
  it("rechaza un directorio truncado", () => {
    assert.throws(() => parseDirectory(Uint8Array.from([3, 0, 1])), /truncado/);
  });
});

describe("fileTileStats", () => {
  it("cuenta por zoom en el directorio raíz", async () => {
    assert.deepEqual(await fileTileStats(write(pmtiles(directory(entries)))), expected);
  });

  it("directorios comprimidos con gzip", async () => {
    assert.deepEqual(await fileTileStats(write(pmtiles(gzipSync(directory(entries)), undefined, 2))), expected);
  });

  it("sigue los directorios hoja", async () => {
    const leafA = directory(entries.slice(0, 2));
    const leafB = directory(entries.slice(2));
    const root = directory([
      { tileId: 0, offset: 0, length: leafA.length, runLength: 0 },
      { tileId: 5, offset: leafA.length, length: leafB.length, runLength: 0 },
    ]);
    const leaves = new Uint8Array(leafA.length + leafB.length);
    leaves.set(leafA, 0);
    leaves.set(leafB, leafA.length);
    assert.deepEqual(await fileTileStats(write(pmtiles(root, leaves))), expected);
  });

  it("una corrida que cruza de zoom se reparte por zoom", async () => {
    // IDs 3-6: los dos últimos de z1 y los dos primeros de z2.
    const root = directory([{ tileId: 3, offset: 0, length: 1, runLength: 4 }]);
    assert.deepEqual(await fileTileStats(write(pmtiles(root))), { tiles: 4, by_zoom: { "1": 2, "2": 2 } });
  });

  it("una corrida enorme no se recorre tile por tile", async () => {
    // Todos los tiles de z0 a z20 en una sola entrada: iterando por ID tardaría minutos.
    const total = (4 ** 21 - 1) / 3;
    const root = directory([{ tileId: 0, offset: 0, length: 1, runLength: total }]);
    const stats = await fileTileStats(write(pmtiles(root)));
    assert.equal(stats.tiles, total);
    assert.equal(stats.by_zoom["20"], 4 ** 20);
  });

  it("sigue una hoja dentro de otra hoja", async () => {
    // raíz → hoja A (bytes 0..) → hoja B con los tiles.
    const leafB = directory(entries);
    const leafA = directory([{ tileId: 0, offset: 64, length: leafB.length, runLength: 0 }]);
    const leaves = new Uint8Array(64 + leafB.length);
    leaves.set(leafA, 0);
    leaves.set(leafB, 64);
    const root = directory([{ tileId: 0, offset: 0, length: leafA.length, runLength: 0 }]);
    assert.deepEqual(await fileTileStats(write(pmtiles(root, leaves))), expected);
  });

  it("rechaza un directorio que se apunta a sí mismo", async () => {
    // Una hoja que apunta al propio directorio hoja: sin límite, recursión infinita.
    const leaf = directory([{ tileId: 0, offset: 0, length: 5, runLength: 0 }]);
    const root = directory([{ tileId: 0, offset: 0, length: leaf.length, runLength: 0 }]);
    await assert.rejects(fileTileStats(write(pmtiles(root, leaf))), /demasiados niveles/);
  });

  it("rechaza lo que no es PMTiles v3", async () => {
    await assert.rejects(fileTileStats(write(pmtiles(directory(entries), undefined, 1, "NoTiles"))), /no es un PMTiles v3/);
  });

  it("rechaza una compresión desconocida", async () => {
    await assert.rejects(fileTileStats(write(pmtiles(directory(entries), undefined, 4))), /compresión interna 4/);
  });

  it("rechaza un archivo truncado", async () => {
    const full = pmtiles(directory(entries));
    await assert.rejects(fileTileStats(write(full.subarray(0, full.length - 2))), /truncado/);
  });
});
