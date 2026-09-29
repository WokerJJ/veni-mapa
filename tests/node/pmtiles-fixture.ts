// PMTiles v3 mínimos para las pruebas: encabezado, directorio raíz y hojas,
// sin tiles (el conteo solo lee directorios).

export interface TestEntry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

export function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

// Directorio v3: cantidad, deltas de ID, run lengths, longitudes y offsets + 1.
export function directory(entries: TestEntry[]): Uint8Array {
  const bytes = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) {
    bytes.push(...varint(e.tileId - last));
    last = e.tileId;
  }
  for (const e of entries) bytes.push(...varint(e.runLength));
  for (const e of entries) bytes.push(...varint(e.length));
  for (const e of entries) bytes.push(...varint(e.offset + 1));
  return Uint8Array.from(bytes);
}

export function pmtiles(root: Uint8Array, leaves: Uint8Array = new Uint8Array(0), compression = 1, magic = "PMTiles"): Uint8Array {
  const header = new Uint8Array(127);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode(magic), 0);
  header[7] = 3;
  view.setBigUint64(8, 127n, true);
  view.setBigUint64(16, BigInt(root.length), true);
  view.setBigUint64(40, BigInt(127 + root.length), true);
  view.setBigUint64(48, BigInt(leaves.length), true);
  header[97] = compression;
  const file = new Uint8Array(127 + root.length + leaves.length);
  file.set(header, 0);
  file.set(root, 127);
  file.set(leaves, 127 + root.length);
  return file;
}
