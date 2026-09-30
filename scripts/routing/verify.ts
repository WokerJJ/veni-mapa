// Verificación del grafo de rutas, parte de `make verify` (verify.sh).
//
//   node scripts/routing/verify.ts --graph build/routing/roldanillo-rutas.json \
//     --source build/routing/source.json --region roldanillo --center=-76.15,4.41 --max-kb 500
//
// --center con "=": sin él, parseArgs toma la longitud negativa por una opción.
//
// Imprime una línea ok/FAIL por comprobación y termina con 1 si alguna falla.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { FORMAT, VERSION, type RoutingGraph } from "./graph.ts";
import { Router, type LngLat } from "./router.ts";

/** Fracción mínima de vértices muestreados a los que se llega desde el centro. */
export const MIN_CONNECTED = 0.9;
const SAMPLES = 60;

export interface Check {
  ok: boolean;
  message: string;
}

export function checkGraph(
  json: string,
  options: { region: string; osmDate: string; center: LngLat; maxKb: number },
): Check[] {
  const checks: Check[] = [];
  const check = (ok: boolean, message: string): void => void checks.push({ ok, message });

  const kb = gzipSync(json, { level: 9 }).length / 1024;
  check(kb <= options.maxKb, `rutas: ${kb.toFixed(0)} KB con gzip (límite ${options.maxKb} KB)`);

  const graph = JSON.parse(json) as RoutingGraph;
  check(graph.format === FORMAT && graph.version === VERSION, `rutas: formato ${String(graph.format)} v${String(graph.version)}`);
  check(graph.region === options.region, `rutas: región '${graph.region}' (se espera '${options.region}')`);
  check(graph.osm_date === options.osmDate, `rutas: OSM del ${graph.osm_date}, igual que source.json (${options.osmDate})`);
  check(graph.license === "ODbL-1.0" && graph.attribution.includes("OpenStreetMap"), "rutas: licencia ODbL y atribución a OpenStreetMap");

  let router: Router;
  try {
    router = new Router(graph);
  } catch (error) {
    check(false, `rutas: el router no carga el grafo: ${error instanceof Error ? error.message : String(error)}`);
    return checks;
  }

  // Desde el centro de la región se tiene que llegar a casi toda la red: una
  // red partida en islas daría "sin ruta" entre puntos que sí se conectan.
  for (const profile of ["foot", "car"] as const) {
    const start = router.nearest(options.center, profile);
    if (start < 0) {
      check(false, `rutas (${profile}): el centro de la región no está cerca de ninguna vía`);
      continue;
    }
    const count = router.lon.length;
    let tried = 0;
    let reached = 0;
    for (let v = 0; v < count; v += Math.max(1, Math.floor(count / SAMPLES))) {
      const point: LngLat = [router.lon[v]!, router.lat[v]!];
      if (router.nearest(point, profile) !== v) continue; // vértice de otro perfil
      tried++;
      if (router.route(options.center, point, profile)) reached++;
    }
    const fraction = tried === 0 ? 0 : reached / tried;
    check(
      fraction >= MIN_CONNECTED,
      `rutas (${profile}): desde el centro se llega a ${reached} de ${tried} vértices de muestra (mínimo ${MIN_CONNECTED * 100} %)`,
    );
  }
  return checks;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      graph: { type: "string" },
      source: { type: "string" },
      region: { type: "string" },
      center: { type: "string" },
      "max-kb": { type: "string" },
    },
  });
  const center = (values.center ?? "").split(",").map(Number);
  const maxKb = Number(values["max-kb"]);
  if (!values.graph || !values.source || !values.region || center.length !== 2 || center.some(Number.isNaN) || !Number.isInteger(maxKb)) {
    throw new Error("uso: verify.ts --graph <rutas.json> --source <source.json> --region <nombre> --center lon,lat --max-kb <n>");
  }
  const source = JSON.parse(readFileSync(values.source, "utf8")) as { osm_date: string };
  const checks = checkGraph(readFileSync(values.graph, "utf8"), {
    region: values.region,
    osmDate: source.osm_date,
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
