// `make routing`, segundo paso: de las vías en OPL (routing-source.sh) al grafo
// "veni-rutas" (graph.ts).
//
//   node scripts/routing/build.ts --opl build/routing/roldanillo-vias.opl \
//     --source build/routing/source.json --out build/routing/roldanillo-rutas.json
//
// Imprime un resumen: vértices, aristas, tamaño y tamaño comprimido con gzip.
import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import {
  CLASSES,
  EDGE_STRIDE,
  FORMAT,
  PRECISION,
  SCALE,
  VERSION,
  accessFlags,
  classIndex,
  distanceM,
  type RoutingGraph,
} from "./graph.ts";

export interface Way {
  id: number;
  tags: Map<string, string>;
  nodes: { id: number; lon: number; lat: number }[];
}

/** OPL escapa espacios, comas, `=`, `@` y `%` como %hex%. */
function unescape(text: string): string {
  return text.replace(/%([0-9a-f]+)%/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** Las vías (`w…`) de un archivo OPL con coordenadas en los nodos (add-locations-to-ways). */
export function parseOpl(opl: string): Way[] {
  const ways: Way[] = [];
  for (const line of opl.split("\n")) {
    if (!line.startsWith("w")) continue;
    const fields = line.split(" ");
    const id = Number(fields[0]!.slice(1));
    const tagField = fields.find((f) => f.startsWith("T"))?.slice(1) ?? "";
    const nodeField = fields.find((f) => f.startsWith("N"))?.slice(1) ?? "";
    const tags = new Map<string, string>();
    for (const pair of tagField ? tagField.split(",") : []) {
      const eq = pair.indexOf("=");
      tags.set(unescape(pair.slice(0, eq)), unescape(pair.slice(eq + 1)));
    }
    const nodes: Way["nodes"] = [];
    for (const ref of nodeField ? nodeField.split(",") : []) {
      const m = /^n(\d+)x(-?[\d.]+)y(-?[\d.]+)$/.exec(ref);
      // Sin coordenadas: el nodo quedó fuera del recorte; la vía se corta ahí.
      if (!m) {
        nodes.push({ id: Number(ref.slice(1).split("x")[0]), lon: NaN, lat: NaN });
        continue;
      }
      nodes.push({ id: Number(m[1]), lon: Number(m[2]), lat: Number(m[3]) });
    }
    ways.push({ id, tags, nodes });
  }
  return ways;
}

interface Meta {
  region: string;
  osm_date: string;
  bbox: [number, number, number, number];
  attribution: string;
}

/** Arma el grafo: vértices en cruces y extremos, aristas entre vértices consecutivos. */
export function buildGraph(ways: Way[], meta: Meta): RoutingGraph {
  const routable = ways
    .map((way) => ({ way, flags: accessFlags(way.tags) }))
    .filter(({ way, flags }) => flags !== 0 && way.nodes.length >= 2);

  // Un nodo es vértice si lo usan dos vías (o dos veces la misma) o si es un extremo.
  const uses = new Map<number, number>();
  for (const { way } of routable) {
    way.nodes.forEach((node, i) => {
      const extra = i === 0 || i === way.nodes.length - 1 ? 2 : 1;
      uses.set(node.id, (uses.get(node.id) ?? 0) + extra);
    });
  }

  const vertexOf = new Map<number, number>();
  const nodes: number[] = [];
  const edges: number[] = [];
  const geometry: number[] = [];
  const geometryCounts: number[] = [];
  let prevX = 0;
  let prevY = 0;

  const vertex = (node: Way["nodes"][number]): number => {
    let index = vertexOf.get(node.id);
    if (index === undefined) {
      index = vertexOf.size;
      vertexOf.set(node.id, index);
      const x = Math.round(node.lon * SCALE);
      const y = Math.round(node.lat * SCALE);
      nodes.push(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    return index;
  };

  for (const { way, flags } of routable) {
    const cls = classIndex(way.tags.get("highway")!);
    // Tramos con coordenadas: un nodo sin ellas corta la vía en dos.
    let segment: Way["nodes"] = [];
    const segments: Way["nodes"][] = [];
    for (const node of way.nodes) {
      if (Number.isNaN(node.lon)) {
        if (segment.length >= 2) segments.push(segment);
        segment = [];
      } else segment.push(node);
    }
    if (segment.length >= 2) segments.push(segment);

    for (const part of segments) {
      let start = 0;
      for (let i = 1; i < part.length; i++) {
        const node = part[i]!;
        const last = i === part.length - 1;
        if (!last && (uses.get(node.id) ?? 0) < 2) continue;
        const from = part[start]!;
        let length = 0;
        for (let j = start + 1; j <= i; j++) {
          length += distanceM(part[j - 1]!.lon, part[j - 1]!.lat, part[j]!.lon, part[j]!.lat);
        }
        const a = vertex(from);
        const b = vertex(node);
        // Un lazo que vuelve al mismo vértice no acorta ninguna ruta.
        if (a !== b) {
          edges.push(a, b, Math.max(1, Math.round(length * 10)), flags, cls);
          let px = Math.round(from.lon * SCALE);
          let py = Math.round(from.lat * SCALE);
          for (let j = start + 1; j < i; j++) {
            const x = Math.round(part[j]!.lon * SCALE);
            const y = Math.round(part[j]!.lat * SCALE);
            geometry.push(x - px, y - py);
            px = x;
            py = y;
          }
          geometryCounts.push(i - start - 1);
        }
        start = i;
      }
    }
  }

  return {
    format: FORMAT,
    version: VERSION,
    region: meta.region,
    osm_date: meta.osm_date,
    bbox: meta.bbox,
    attribution: meta.attribution,
    license: "ODbL-1.0",
    precision: PRECISION,
    classes: CLASSES.map((c) => c.highway),
    nodes,
    edges,
    geometry,
    geometry_counts: geometryCounts,
  };
}

export function summary(graph: RoutingGraph, json: string): string {
  const gz = gzipSync(json, { level: 9 }).length;
  return `${graph.nodes.length / 2} vértices, ${graph.edges.length / EDGE_STRIDE} aristas, ${(json.length / 1024).toFixed(0)} KB (${(gz / 1024).toFixed(0)} KB con gzip)`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { opl: { type: "string" }, source: { type: "string" }, out: { type: "string" } },
  });
  if (!values.opl || !values.source || !values.out) {
    throw new Error("uso: build.ts --opl <vías.opl> --source <source.json> --out <rutas.json>");
  }
  const source = JSON.parse(await readFile(values.source, "utf8")) as { region: string; osm_date: string; bbox: [number, number, number, number] };
  const graph = buildGraph(parseOpl(await readFile(values.opl, "utf8")), {
    region: source.region,
    osm_date: source.osm_date,
    bbox: source.bbox,
    attribution: "© colaboradores de OpenStreetMap",
  });
  if (graph.edges.length === 0) throw new Error(`${values.opl} no tiene vías transitables`);
  const json = JSON.stringify(graph);
  await writeFile(`${values.out}.tmp`, json);
  await rename(`${values.out}.tmp`, values.out);
  console.log(`==> Listo: ${values.out} (${summary(graph, json)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(`build.ts: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
