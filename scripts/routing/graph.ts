// Formato "veni-rutas" v1: la red de calles de la región para calcular rutas en
// el navegador. Lo escribe scripts/routing/build.ts y lo lee router.ts.
//
// Un grafo dirigido por perfil (a pie y en vehículo) comparte los mismos
// vértices y aristas: cada arista lleva banderas de qué perfil la puede
// recorrer en qué sentido. Los vértices son solo cruces y extremos de vía; los
// nodos intermedios de OSM quedan como geometría de la arista, que se usa para
// dibujar la ruta pero no para buscarla.
//
// JSON en vez de un binario propio: el navegador lo decodifica de forma nativa,
// comprimido (gzip o brotli, que Pages y Cloudflare aplican solos) pesa poco
// porque todo son enteros chicos con codificación delta, y se puede inspeccionar
// a mano. Formatos como los de OSRM o GraphHopper asumen un servidor de rutas.

export const FORMAT = "veni-rutas";
export const VERSION = 1;

/** Coordenadas en enteros: grados × 10^PRECISION (10^-6 ° ≈ 0,11 m). */
export const PRECISION = 6;
export const SCALE = 10 ** PRECISION;

/** Banderas de una arista: qué perfil la recorre en qué sentido. */
export const CAR_FORWARD = 1;
export const CAR_BACKWARD = 2;
export const FOOT_FORWARD = 4;
export const FOOT_BACKWARD = 8;

export type Profile = "foot" | "car";

/**
 * Tipos de vía que entran al grafo, en el orden en que se guardan (índice en
 * `classes`), con la velocidad en vehículo en km/h. Sin velocidad: solo a pie.
 */
export const CLASSES: readonly { highway: string; carKmh?: number }[] = [
  { highway: "motorway", carKmh: 90 },
  { highway: "motorway_link", carKmh: 45 },
  { highway: "trunk", carKmh: 70 },
  { highway: "trunk_link", carKmh: 40 },
  { highway: "primary", carKmh: 55 },
  { highway: "primary_link", carKmh: 35 },
  { highway: "secondary", carKmh: 45 },
  { highway: "secondary_link", carKmh: 30 },
  { highway: "tertiary", carKmh: 40 },
  { highway: "tertiary_link", carKmh: 25 },
  { highway: "unclassified", carKmh: 30 },
  { highway: "residential", carKmh: 25 },
  { highway: "living_street", carKmh: 10 },
  { highway: "service", carKmh: 15 },
  // Caminos rurales: por ellos se llega a muchas veredas en carro.
  { highway: "track", carKmh: 12 },
  { highway: "pedestrian" },
  { highway: "footway" },
  { highway: "path" },
  { highway: "steps" },
  { highway: "cycleway" },
  { highway: "bridleway" },
  { highway: "corridor" },
];

/** Velocidad a pie, igual en todas las vías. */
export const FOOT_KMH = 4.5;

export interface RoutingGraph {
  format: typeof FORMAT;
  version: typeof VERSION;
  region: string;
  /** Fecha del extracto de OpenStreetMap (AAAAMMDD). */
  osm_date: string;
  bbox: [number, number, number, number];
  attribution: string;
  license: "ODbL-1.0";
  precision: typeof PRECISION;
  /** highway de cada clase, por índice. */
  classes: string[];
  /** Vértices: [lon, lat] en enteros, cada par como diferencia con el anterior. */
  nodes: number[];
  /** Aristas: [desde, hasta, largo en decímetros, banderas, clase] por arista. */
  edges: number[];
  /**
   * Puntos intermedios de todas las aristas, en enteros y como diferencia con
   * el punto anterior (el primero, con el vértice `desde`).
   */
  geometry: number[];
  /** Cantidad de puntos intermedios de cada arista, en orden. */
  geometry_counts: number[];
}

export const EDGE_STRIDE = 5;

// Valores de acceso (OSM) que permiten o prohíben el paso.
const ALLOWED = new Set(["yes", "designated", "permissive", "destination", "customers", "delivery", "official"]);
const DENIED = new Set(["no", "private", "agricultural", "forestry", "use_sidepath"]);

/**
 * ¿Se puede pasar? Busca de la etiqueta más específica a la más general
 * (por ejemplo motorcar → motor_vehicle → vehicle → access); la primera que
 * diga algo conocido decide. Sin ninguna, se puede.
 */
function allowed(tags: ReadonlyMap<string, string>, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = tags.get(key);
    if (value === undefined) continue;
    if (ALLOWED.has(value)) return true;
    if (DENIED.has(value)) return false;
  }
  return true;
}

/** Sentido único: 1 a favor del dibujo de la vía, -1 en contra, 0 doble sentido. */
function oneway(value: string | undefined, implied: boolean): 1 | -1 | 0 {
  if (value === "yes" || value === "true" || value === "1") return 1;
  if (value === "-1" || value === "reverse") return -1;
  if (value === "no" || value === "false" || value === "0") return 0;
  return implied ? 1 : 0;
}

/** Banderas de una vía de OSM según sus etiquetas; 0 si no entra al grafo. */
export function accessFlags(tags: ReadonlyMap<string, string>): number {
  const highway = tags.get("highway");
  const cls = CLASSES.find((c) => c.highway === highway);
  if (!cls || tags.get("area") === "yes") return 0;
  let flags = 0;

  if (cls.carKmh !== undefined && allowed(tags, ["motorcar", "motor_vehicle", "vehicle", "access"])) {
    const roundabout = tags.get("junction") === "roundabout" || tags.get("junction") === "circular";
    const implied = roundabout || highway === "motorway" || highway === "motorway_link";
    const dir = oneway(tags.get("oneway"), implied);
    if (dir >= 0) flags |= CAR_FORWARD;
    if (dir <= 0) flags |= CAR_BACKWARD;
  }

  const motorOnly = highway === "motorway" || highway === "motorway_link" || tags.get("motorroad") === "yes";
  if (!motorOnly && allowed(tags, ["foot", "access"])) {
    // A pie el sentido único de los carros no aplica, salvo oneway:foot.
    const dir = oneway(tags.get("oneway:foot"), false);
    if (dir >= 0) flags |= FOOT_FORWARD;
    if (dir <= 0) flags |= FOOT_BACKWARD;
  }
  return flags;
}

export function classIndex(highway: string): number {
  return CLASSES.findIndex((c) => c.highway === highway);
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Distancia en metros entre dos puntos [lon, lat] en grados (haversine). */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
