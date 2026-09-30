// Verificación del grafo de rutas, parte de `make verify` (verify.sh).
//
//   node scripts/routing/verify.ts --graph build/routing/roldanillo-rutas.json \
//     --source build/routing/source.json --region roldanillo \
//     --bbox=-76.30,4.30,-76.00,4.55 --center=-76.15,4.41 --max-kb 500
//
// --bbox y --center con "=": sin él, parseArgs toma la longitud negativa por una opción.
//
// Imprime una línea ok/FAIL por comprobación y termina con 1 si alguna falla.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { FORMAT, VERSION, type RoutingGraph } from "./graph.ts";
import { Router, type LngLat } from "./router.ts";

/** Fracción mínima de los vértices con vías que tiene que estar en la red principal. */
export const MIN_CONNECTED = 0.9;

export interface Check {
  ok: boolean;
  message: string;
}

export interface Source {
  osm_date: string;
  source: string;
  source_md5: string;
}

export function checkGraph(
  json: string,
  options: { region: string; bbox: number[]; source: Source; center: LngLat; maxKb: number },
): Check[] {
  const checks: Check[] = [];
  const check = (ok: boolean, message: string): void => void checks.push({ ok, message });

  const kb = gzipSync(json, { level: 9 }).length / 1024;
  check(kb <= options.maxKb, `rutas: ${kb.toFixed(0)} KB con gzip (límite ${options.maxKb} KB)`);

  const graph = JSON.parse(json) as RoutingGraph;
  check(graph.format === FORMAT && graph.version === VERSION, `rutas: formato ${String(graph.format)} v${String(graph.version)}`);
  check(graph.region === options.region, `rutas: región '${graph.region}' (se espera '${options.region}')`);
  check(
    JSON.stringify(graph.bbox) === JSON.stringify(options.bbox),
    `rutas: caja ${JSON.stringify(graph.bbox)} igual a la de la región (${JSON.stringify(options.bbox)})`,
  );
  const { source } = options;
  check(
    graph.osm_date === source.osm_date && graph.source === source.source && graph.source_md5 === source.source_md5,
    `rutas: OSM del ${graph.osm_date} (${graph.source}), igual que source.json`,
  );
  check(graph.license === "ODbL-1.0" && graph.attribution.includes("OpenStreetMap"), "rutas: licencia ODbL y atribución a OpenStreetMap");

  let router: Router;
  try {
    router = new Router(graph);
  } catch (error) {
    check(false, `rutas: el router no carga el grafo: ${error instanceof Error ? error.message : String(error)}`);
    return checks;
  }

  // Casi toda la red tiene que estar conectada entre sí: las islas y los
  // sentidos únicos sin salida quedan fuera de los ajustes, y si son muchos es
  // que el recorte o las reglas de acceso partieron la red.
  for (const profile of ["foot", "car"] as const) {
    const { main, total } = router.network(profile);
    check(
      total > 0 && main / total >= MIN_CONNECTED,
      `rutas (${profile}): la red principal tiene ${main} de ${total} vértices (mínimo ${MIN_CONNECTED * 100} %)`,
    );
    check(router.nearest(options.center, profile) >= 0, `rutas (${profile}): el centro de la región está cerca de la red principal`);
  }
  return checks;
}

function numbers(text: string | undefined, length: number): number[] | null {
  const values = (text ?? "").split(",").map(Number);
  return values.length === length && values.every(Number.isFinite) ? values : null;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      graph: { type: "string" },
      source: { type: "string" },
      region: { type: "string" },
      bbox: { type: "string" },
      center: { type: "string" },
      "max-kb": { type: "string" },
    },
  });
  const bbox = numbers(values.bbox, 4);
  const center = numbers(values.center, 2);
  const maxKb = Number(values["max-kb"]);
  if (!values.graph || !values.source || !values.region || !bbox || !center || !Number.isInteger(maxKb)) {
    throw new Error("uso: verify.ts --graph <rutas.json> --source <source.json> --region <nombre> --bbox=o,s,e,n --center=lon,lat --max-kb <n>");
  }
  const checks = checkGraph(readFileSync(values.graph, "utf8"), {
    region: values.region,
    bbox,
    source: JSON.parse(readFileSync(values.source, "utf8")) as Source,
    center: center as LngLat,
    maxKb,
  });
  for (const { ok, message } of checks) console.log(`${ok ? "ok  " : "FAIL"} - ${message}`);
  if (checks.some((c) => !c.ok)) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`verify.ts: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
