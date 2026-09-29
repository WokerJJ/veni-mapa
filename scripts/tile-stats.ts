// Cuenta los tiles de un PMTiles v3 por zoom, leyendo solo sus directorios.
//
//   node scripts/tile-stats.ts build/roldanillo.pmtiles
//   {"tiles": 1234, "by_zoom": {"0": 1, "1": 1, ...}}
//
// go-pmtiles no reporta tiles por zoom; lo usa el reporte de la actualización
// mensual (update-report.ts). Un tile repetido (run_length > 1, por ejemplo mar
// abierto) cuenta una vez por posición.
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export interface TileStats {
  tiles: number;
  by_zoom: Record<string, number>;
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

const HEADER_BYTES = 127;
// Límite de niveles de directorios hoja: la especificación usa uno; más de
// unos pocos solo aparece en un archivo corrupto o malicioso.
const MAX_DEPTH = 4;
// Tope de entradas leídas en total: acota el trabajo ante un archivo con
// muchas hojas que apuntan al mismo directorio. El extracto real tiene ~1.000.
const MAX_ENTRIES = 5_000_000;

type Read = (offset: number, length: number) => Promise<Uint8Array>;

function uint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PMTiles: valor de 64 bits fuera de rango");
  return Number(value);
}

function decompress(data: Uint8Array, compression: number): Uint8Array {
  // 1 = sin compresión, 2 = gzip (lo que escribe go-pmtiles).
  if (compression === 1) return data;
  if (compression === 2) return gunzipSync(data);
  throw new Error(`PMTiles: compresión interna ${compression} no soportada`);
}

export function readVarint(buf: Uint8Array, pos: { i: number }): number {
  let value = 0;
  let factor = 1;
  for (let shift = 0; shift < 64; shift += 7) {
    if (pos.i >= buf.length) throw new Error("PMTiles: directorio truncado");
    const byte = buf[pos.i++]!;
    value += (byte & 0x7f) * factor;
    if (!Number.isSafeInteger(value)) throw new Error("PMTiles: varint fuera de rango");
    if (byte < 0x80) return value;
    factor *= 128;
  }
  throw new Error("PMTiles: varint inválido");
}

export function parseDirectory(buf: Uint8Array): Entry[] {
  const pos = { i: 0 };
  const n = readVarint(buf, pos);
  const entries: Entry[] = [];
  let lastId = 0;
  for (let k = 0; k < n; k++) {
    lastId += readVarint(buf, pos);
    entries.push({ tileId: lastId, offset: 0, length: 0, runLength: 0 });
  }
  for (const e of entries) e.runLength = readVarint(buf, pos);
  for (const e of entries) e.length = readVarint(buf, pos);
  for (let k = 0; k < n; k++) {
    const v = readVarint(buf, pos);
    // 0 = contiguo al anterior (formato v3).
    entries[k]!.offset = v === 0 && k > 0 ? entries[k - 1]!.offset + entries[k - 1]!.length : v - 1;
  }
  return entries;
}

// Primer tile ID del zoom z: (4^z - 1) / 3.
function firstId(z: number): number {
  return (4 ** z - 1) / 3;
}

// Zoom de un tile ID de PMTiles: los IDs de z empiezan en (4^z - 1) / 3.
export function zoomOf(tileId: number): number {
  let z = 0;
  let base = 0;
  for (; z < 32; z++) {
    const next = base + 4 ** z;
    if (tileId < next) return z;
    base = next;
  }
  throw new Error(`PMTiles: tile ID fuera de rango: ${tileId}`);
}

export async function tileStats(read: Read): Promise<TileStats> {
  const header = await read(0, HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (new TextDecoder().decode(header.subarray(0, 7)) !== "PMTiles" || header[7] !== 3) {
    throw new Error("no es un PMTiles v3");
  }
  const rootOffset = uint64(view, 8);
  const rootLength = uint64(view, 16);
  const leafOffset = uint64(view, 40);
  const compression = header[97]!;

  const byZoom = new Map<number, number>();
  let tiles = 0;
  let entriesRead = 0;
  const walk = async (offset: number, length: number, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error("PMTiles: demasiados niveles de directorios");
    const entries = parseDirectory(decompress(await read(offset, length), compression));
    entriesRead += entries.length;
    if (entriesRead > MAX_ENTRIES) throw new Error("PMTiles: demasiadas entradas de directorio");
    for (const e of entries) {
      if (e.runLength === 0) {
        await walk(leafOffset + e.offset, e.length, depth + 1);
        continue;
      }
      // La corrida [tileId, tileId + runLength) se reparte por zoom con
      // aritmética de intervalos, sin recorrer ID por ID.
      const end = e.tileId + e.runLength;
      for (let z = zoomOf(e.tileId); firstId(z) < end; z++) {
        const count = Math.min(end, firstId(z + 1)) - Math.max(e.tileId, firstId(z));
        byZoom.set(z, (byZoom.get(z) ?? 0) + count);
      }
      tiles += e.runLength;
    }
  };
  await walk(rootOffset, rootLength, 0);

  const by_zoom: Record<string, number> = {};
  for (const z of [...byZoom.keys()].sort((a, b) => a - b)) by_zoom[String(z)] = byZoom.get(z)!;
  return { tiles, by_zoom };
}

export async function fileTileStats(path: string): Promise<TileStats> {
  const file = await open(path, "r");
  try {
    return await tileStats(async (offset, length) => {
      const buf = new Uint8Array(length);
      const { bytesRead } = await file.read(buf, 0, length, offset);
      if (bytesRead !== length) throw new Error("PMTiles: archivo truncado");
      return buf;
    });
  } finally {
    await file.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const path = process.argv[2];
  if (!path) {
    console.error("uso: node scripts/tile-stats.ts <archivo.pmtiles>");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await fileTileStats(path)));
  } catch (error) {
    console.error(`tile-stats.ts: ${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}
