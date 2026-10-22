// Implementación de referencia para calcular rutas sobre un grafo "veni-rutas"
// (graph.ts). No usa APIs de Node: la app la puede usar tal cual en el navegador.
//
//   const router = new Router(await (await fetch(url)).json());
//   const ruta = router.route([lon, lat], [lon, lat], "foot");  // o "car"
//
// Búsqueda A* con el tiempo como costo: a pie, el largo a velocidad constante;
// en vehículo, el largo a la velocidad de cada tipo de vía, así prefiere las vías
// principales aunque den un poco más de vuelta. La heurística es la distancia
// en línea recta a la velocidad máxima del perfil, que nunca sobreestima: la
// ruta encontrada es la más rápida del grafo.
//
// Los puntos se ajustan al punto más cercano sobre una calle de la red principal
// del perfil (su mayor componente fuertemente conexa: desde cualquiera de sus
// vértices se llega a todos los demás). Así un punto junto a una calle aislada o
// al final de un sentido único sin salida se ajusta a la red y siempre tiene ruta.
// La ruta sale del punto ajustado por cualquiera de los dos extremos de su
// arista (en vehículo, solo por los que permite el sentido de la vía) con un
// costo proporcional al tramo recorrido, y si origen y destino caen en la misma
// arista y el sentido lo permite, la ruta es ese tramo directo. Ajustar al
// vértice más cercano fallaba en las calles largas: un destino a mitad de cuadra
// podía quedar en el fondo de una calle sin salida vecina y la ruta daba la
// vuelta a la manzana.
//
// Límites: no hay giros prohibidos, semáforos ni tráfico. Es para dibujar el
// camino, no para navegar paso a paso.
import {
  CAR_BACKWARD,
  CAR_FORWARD,
  CLASSES,
  EDGE_STRIDE,
  FOOT_BACKWARD,
  FOOT_FORWARD,
  FOOT_KMH,
  FORMAT,
  SCALE,
  VERSION,
  distanceM,
  type Profile,
  type RoutingGraph,
} from "./graph.ts";

export type LngLat = [number, number];

export interface Route {
  /** Metros. */
  distance: number;
  /** Segundos estimados. */
  duration: number;
  /** Camino para dibujar, del punto ajustado de salida al de llegada. */
  coordinates: LngLat[];
  /**
   * Metros entre cada punto pedido y el punto de la calle al que se ajustó: la
   * app puede dibujar ese tramo aparte o avisar si es largo.
   */
  snap: { from: number; to: number };
}

/** Punto de la red principal más cercano a un punto pedido, sobre una arista. */
export interface Snap {
  /** Arista en la que cae. */
  edge: number;
  /** Tramo de la arista: entre su punto k y el k + 1, contando los vértices. */
  segment: number;
  /** Parte del largo de la arista desde su vértice `desde`, de 0 a 1. */
  fraction: number;
  /** El punto ajustado, sobre la calle. */
  point: LngLat;
  /** Metros entre el punto pedido y el ajustado. */
  distance: number;
}

/** Distancia máxima, en metros, entre un punto pedido y el punto de la red al que se ajusta. */
export const MAX_SNAP_M = 1000;

const CELL_DEG = 0.005; // ~550 m en Roldanillo
const METERS_PER_DEG = (2 * Math.PI * 6_371_008.8) / 360;
/** Un punto ajustado a menos de esto de un extremo de su arista se ajusta al vértice. */
const VERTEX_TOLERANCE_M = 2;

interface Adjacency {
  /** Arcos del vértice v: de start[v] a start[v + 1] en target, edge y reversed. */
  start: Int32Array;
  target: Int32Array;
  edge: Int32Array;
  reversed: Uint8Array;
  /** Vértices de la red principal, por celda de la grilla. */
  grid: Map<string, number[]>;
  /** Tramos de las aristas de la red principal, por cada celda que toca su caja. */
  segments: Map<string, number[]>;
  /** Tamaño de la red principal y cantidad de vértices con algún arco. */
  network: { main: number; total: number };
}

export class Router {
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  private readonly graph: RoutingGraph;
  private readonly edgeGeometryStart: Int32Array;
  /**
   * Línea completa de cada arista (vértice desde, puntos intermedios y vértice
   * hasta): la de la arista e va de lineStart[e] a lineStart[e + 1] - 1. El tramo
   * s (entre los puntos k y k + 1 de la arista e) empieza en el punto s + e.
   */
  private readonly lineStart: Int32Array;
  private readonly lineLon: Float64Array;
  private readonly lineLat: Float64Array;
  /** Arista de cada tramo. */
  private readonly segmentEdge: Int32Array;
  private readonly adjacency: Record<Profile, Adjacency>;

  constructor(graph: RoutingGraph) {
    if (graph.format !== FORMAT || graph.version !== VERSION) {
      throw new Error(`formato no soportado: ${String(graph.format)} v${String(graph.version)} (se espera ${FORMAT} v${VERSION})`);
    }
    this.graph = graph;
    const count = graph.nodes.length / 2;
    this.lon = new Float64Array(count);
    this.lat = new Float64Array(count);
    let x = 0;
    let y = 0;
    for (let i = 0; i < count; i++) {
      x += graph.nodes[2 * i]!;
      y += graph.nodes[2 * i + 1]!;
      this.lon[i] = x / SCALE;
      this.lat[i] = y / SCALE;
    }
    const edges = graph.edges.length / EDGE_STRIDE;
    this.edgeGeometryStart = new Int32Array(edges + 1);
    for (let e = 0; e < edges; e++) {
      this.edgeGeometryStart[e + 1] = this.edgeGeometryStart[e]! + graph.geometry_counts[e]!;
    }
    this.lineStart = new Int32Array(edges + 1);
    for (let e = 0; e < edges; e++) this.lineStart[e + 1] = this.lineStart[e]! + graph.geometry_counts[e]! + 2;
    this.lineLon = new Float64Array(this.lineStart[edges]!);
    this.lineLat = new Float64Array(this.lineStart[edges]!);
    this.segmentEdge = new Int32Array(this.lineStart[edges]! - edges);
    for (let e = 0; e < edges; e++) {
      // Igual que edgeGeometry, pero sin crear arreglos por arista.
      const a = graph.edges[e * EDGE_STRIDE]!;
      const b = graph.edges[e * EDGE_STRIDE + 1]!;
      let q = this.lineStart[e]!;
      let gx = Math.round(this.lon[a]! * SCALE);
      let gy = Math.round(this.lat[a]! * SCALE);
      this.lineLon[q] = this.lon[a]!;
      this.lineLat[q++] = this.lat[a]!;
      for (let k = this.edgeGeometryStart[e]!; k < this.edgeGeometryStart[e + 1]!; k++) {
        gx += graph.geometry[2 * k]!;
        gy += graph.geometry[2 * k + 1]!;
        this.lineLon[q] = gx / SCALE;
        this.lineLat[q++] = gy / SCALE;
      }
      this.lineLon[q] = this.lon[b]!;
      this.lineLat[q] = this.lat[b]!;
      this.segmentEdge.fill(e, this.lineStart[e]! - e, this.lineStart[e + 1]! - e - 1);
    }
    this.adjacency = {
      foot: this.buildAdjacency(FOOT_FORWARD, FOOT_BACKWARD),
      car: this.buildAdjacency(CAR_FORWARD, CAR_BACKWARD),
    };
  }

  /** Lista de adyacencia compacta (CSR) de un perfil y su grilla de vértices. */
  private buildAdjacency(forward: number, backward: number): Adjacency {
    const { edges } = this.graph;
    const count = this.lon.length;
    const degree = new Int32Array(count + 1);
    const each = (fn: (from: number, to: number, e: number, reversed: boolean) => void): void => {
      for (let e = 0; e < edges.length / EDGE_STRIDE; e++) {
        const a = edges[e * EDGE_STRIDE]!;
        const b = edges[e * EDGE_STRIDE + 1]!;
        const flags = edges[e * EDGE_STRIDE + 3]!;
        if (flags & forward) fn(a, b, e, false);
        if (flags & backward) fn(b, a, e, true);
      }
    };
    each((from) => degree[from + 1]!++);
    const hasArc = new Uint8Array(count);
    each((from, to) => {
      hasArc[from] = 1;
      hasArc[to] = 1;
    });
    for (let v = 0; v < count; v++) degree[v + 1]! += degree[v]!;
    const start = degree;
    const fill = start.slice(0, count);
    const total = start[count]!;
    const target = new Int32Array(total);
    const edge = new Int32Array(total);
    const reversed = new Uint8Array(total);
    each((from, to, e, rev) => {
      const i = fill[from]!++;
      target[i] = to;
      edge[i] = e;
      reversed[i] = rev ? 1 : 0;
    });
    const main = mainComponent(start, target, hasArc);
    const grid = new Map<string, number[]>();
    let mainCount = 0;
    let arcCount = 0;
    for (let v = 0; v < count; v++) {
      arcCount += hasArc[v]!;
      if (!main[v]) continue;
      mainCount++;
      const key = cellKey(Math.floor(this.lon[v]! / CELL_DEG), Math.floor(this.lat[v]! / CELL_DEG));
      const cell = grid.get(key);
      if (cell) cell.push(v);
      else grid.set(key, [v]);
    }
    // Solo las aristas con ambos extremos en la red principal: desde un punto
    // sobre ellas siempre se sale y se llega, sea cual sea su sentido.
    const segments = new Map<string, number[]>();
    for (let e = 0; e < edges.length / EDGE_STRIDE; e++) {
      const flags = edges[e * EDGE_STRIDE + 3]!;
      if (!(flags & (forward | backward)) || !main[edges[e * EDGE_STRIDE]!] || !main[edges[e * EDGE_STRIDE + 1]!]) continue;
      for (let p = this.lineStart[e]!; p < this.lineStart[e + 1]! - 1; p++) {
        const x0 = Math.floor(Math.min(this.lineLon[p]!, this.lineLon[p + 1]!) / CELL_DEG);
        const x1 = Math.floor(Math.max(this.lineLon[p]!, this.lineLon[p + 1]!) / CELL_DEG);
        const y0 = Math.floor(Math.min(this.lineLat[p]!, this.lineLat[p + 1]!) / CELL_DEG);
        const y1 = Math.floor(Math.max(this.lineLat[p]!, this.lineLat[p + 1]!) / CELL_DEG);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const key = cellKey(x, y);
            const cell = segments.get(key);
            if (cell) cell.push(p - e);
            else segments.set(key, [p - e]);
          }
        }
      }
    }
    return { start, target, edge, reversed, grid, segments, network: { main: mainCount, total: arcCount } };
  }

  /** Vértices de la red principal de un perfil y vértices con algún arco (para verificar el grafo). */
  network(profile: Profile): { main: number; total: number } {
    return { ...this.adjacency[profile].network };
  }

  /**
   * Vértice de la red principal más cercano a un punto para un perfil, o -1 si
   * no hay ninguno a menos de MAX_SNAP_M. route() no lo usa (se ajusta a la
   * calle con snap); queda para quien necesite un vértice del grafo.
   */
  nearest([lon, lat]: LngLat, profile: Profile): number {
    const { grid } = this.adjacency[profile];
    const cx = Math.floor(lon / CELL_DEG);
    const cy = Math.floor(lat / CELL_DEG);
    const cellM = distanceM(lon, lat, lon, lat + CELL_DEG);
    const rings = Math.ceil(MAX_SNAP_M / cellM) + 1;
    let best = -1;
    let bestM = MAX_SNAP_M;
    for (let r = 0; r <= rings; r++) {
      // Un anillo más lejos que lo mejor encontrado ya no puede mejorarlo.
      if (best >= 0 && (r - 1) * cellM > bestM) break;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const v of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
            const d = distanceM(lon, lat, this.lon[v]!, this.lat[v]!);
            if (d <= bestM) {
              bestM = d;
              best = v;
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * Punto más cercano a `[lon, lat]` sobre una arista de la red principal del
   * perfil, o null si no hay ninguna a menos de MAX_SNAP_M. Recorre la grilla
   * por anillos desde la celda del punto, como nearest.
   */
  snap([lon, lat]: LngLat, profile: Profile): Snap | null {
    const { segments } = this.adjacency[profile];
    // Plano local en metros alrededor del punto: a menos de 1 km, la diferencia
    // con la distancia sobre la esfera es despreciable.
    const ky = METERS_PER_DEG;
    const kx = METERS_PER_DEG * Math.cos((lat * Math.PI) / 180);
    const cx = Math.floor(lon / CELL_DEG);
    const cy = Math.floor(lat / CELL_DEG);
    const cellM = CELL_DEG * kx; // el lado más corto de la celda
    const rings = Math.ceil(MAX_SNAP_M / cellM) + 1;
    let best = -1;
    let bestT = 0;
    let bestM = MAX_SNAP_M;
    for (let r = 0; r <= rings; r++) {
      // Un anillo más lejos que lo mejor encontrado ya no puede mejorarlo.
      if (best >= 0 && (r - 1) * cellM > bestM) break;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          for (const s of segments.get(cellKey(cx + dx, cy + dy)) ?? []) {
            const p = s + this.segmentEdge[s]!;
            const ax = (this.lineLon[p]! - lon) * kx;
            const ay = (this.lineLat[p]! - lat) * ky;
            const ux = (this.lineLon[p + 1]! - lon) * kx - ax;
            const uy = (this.lineLat[p + 1]! - lat) * ky - ay;
            const len2 = ux * ux + uy * uy;
            const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * ux + ay * uy) / len2)) : 0;
            const d = Math.hypot(ax + t * ux, ay + t * uy);
            if (d < bestM || (best < 0 && d === bestM)) {
              bestM = d;
              best = s;
              bestT = t;
            }
          }
        }
      }
    }
    if (best < 0) return null;
    const edge = this.segmentEdge[best]!;
    const p = best + edge;
    const first = this.lineStart[edge]!;
    const last = this.lineStart[edge + 1]! - 1;
    const point: LngLat =
      bestT === 0
        ? [this.lineLon[p]!, this.lineLat[p]!]
        : bestT === 1
          ? [this.lineLon[p + 1]!, this.lineLat[p + 1]!]
          : [
              this.lineLon[p]! + bestT * (this.lineLon[p + 1]! - this.lineLon[p]!),
              this.lineLat[p]! + bestT * (this.lineLat[p + 1]! - this.lineLat[p]!),
            ];
    // Qué parte del largo de la arista queda antes del punto.
    let along = 0;
    let total = 0;
    for (let q = first; q < last; q++) {
      const m = distanceM(this.lineLon[q]!, this.lineLat[q]!, this.lineLon[q + 1]!, this.lineLat[q + 1]!);
      if (q < p) along += m;
      else if (q === p) along += bestT * m;
      total += m;
    }
    // Casi encima de un extremo cuenta como el vértice: así un punto en un cruce
    // (o corrido unos centímetros por el redondeo de las coordenadas) no queda
    // sobre una vía de sentido único que le prohíbe volver al cruce.
    if (along <= VERTEX_TOLERANCE_M || total - along <= VERTEX_TOLERANCE_M) {
      const atEnd = total - along < along;
      const q = atEnd ? last : first;
      const vertex: LngLat = [this.lineLon[q]!, this.lineLat[q]!];
      return { edge, segment: atEnd ? last - first - 1 : 0, fraction: atEnd ? 1 : 0, point: vertex, distance: distanceM(lon, lat, ...vertex) };
    }
    const fraction = Math.min(1, along / total);
    return { edge, segment: p - first, fraction, point, distance: distanceM(lon, lat, point[0], point[1]) };
  }

  /** Ruta más rápida entre dos puntos, o null si alguno no está cerca de una vía o no hay conexión. */
  route(from: LngLat, to: LngLat, profile: Profile): Route | null {
    const source = this.snap(from, profile);
    const target = this.snap(to, profile);
    if (!source || !target) return null;
    const { start, target: arcTarget, edge: arcEdge, reversed } = this.adjacency[profile];
    const { edges } = this.graph;
    const [forward, backward] = profile === "foot" ? [FOOT_FORWARD, FOOT_BACKWARD] : [CAR_FORWARD, CAR_BACKWARD];
    const maxSpeed = profile === "foot" ? FOOT_KMH / 3.6 : Math.max(...CLASSES.map((c) => c.carKmh ?? 0)) / 3.6;
    const speed = (cls: number): number => (profile === "foot" ? FOOT_KMH : CLASSES[cls]!.carKmh!) / 3.6;
    const lengthM = (e: number): number => edges[e * EDGE_STRIDE + 2]! / 10;
    const seconds = (e: number, meters: number): number => meters / speed(edges[e * EDGE_STRIDE + 4]!);
    const goes = (e: number, flag: number): boolean => (edges[e * EDGE_STRIDE + 3]! & flag) !== 0;

    // Tramos parciales en las aristas del origen y del destino, en metros
    // (Infinity si el sentido no lo permite). Desde el punto ajustado se va hacia
    // el vértice `desde` (a) contra el dibujo de la arista y hacia `hasta` (b) a
    // favor; si el punto es el propio vértice, el tramo mide cero en cualquier
    // sentido.
    const sa = edges[source.edge * EDGE_STRIDE]!;
    const sb = edges[source.edge * EDGE_STRIDE + 1]!;
    const ta = edges[target.edge * EDGE_STRIDE]!;
    const tb = edges[target.edge * EDGE_STRIDE + 1]!;
    const sL = lengthM(source.edge);
    const tL = lengthM(target.edge);
    const leaveToA = goes(source.edge, backward) || source.fraction === 0 ? source.fraction * sL : Infinity;
    const leaveToB = goes(source.edge, forward) || source.fraction === 1 ? (1 - source.fraction) * sL : Infinity;
    const arriveFromA = goes(target.edge, forward) || target.fraction === 0 ? target.fraction * tL : Infinity;
    const arriveFromB = goes(target.edge, backward) || target.fraction === 1 ? (1 - target.fraction) * tL : Infinity;

    // Misma arista: el tramo directo, si el sentido lo permite.
    let bestTime = Infinity;
    let bestEnd = -1; // vértice por el que se entra a la arista del destino; -1, tramo directo
    let bestFromA = false;
    if (source.edge === target.edge) {
      const delta = target.fraction - source.fraction;
      if (delta === 0 || (delta > 0 && goes(source.edge, forward)) || (delta < 0 && goes(source.edge, backward))) {
        bestTime = seconds(source.edge, Math.abs(delta) * sL);
      }
    }

    const count = this.lon.length;
    const time = new Float64Array(count).fill(Infinity);
    const via = new Int32Array(count).fill(-1); // arco por el que se llegó; -1 en los vértices de salida
    const done = new Uint8Array(count);
    const [px, py] = target.point;
    const heuristic = (v: number): number => distanceM(this.lon[v]!, this.lat[v]!, px, py) / maxSpeed;
    const heap = new MinHeap();
    for (const [v, meters] of [[sa, leaveToA], [sb, leaveToB]] as const) {
      const t = seconds(source.edge, meters);
      if (t < time[v]!) {
        time[v] = t;
        heap.push(v, t + heuristic(v));
      }
    }

    // A*: la heurística tampoco sobreestima el tramo final, así que cuando la
    // menor prioridad pendiente alcanza el mejor tiempo conocido ya no se mejora.
    while (heap.size > 0 && heap.minPriority < bestTime) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      for (const [end, meters, fromA] of [[ta, arriveFromA, true], [tb, arriveFromB, false]] as const) {
        if (v !== end || meters === Infinity) continue;
        const t = time[v]! + seconds(target.edge, meters);
        if (t < bestTime) {
          bestTime = t;
          bestEnd = v;
          bestFromA = fromA;
        }
      }
      for (let i = start[v]!; i < start[v + 1]!; i++) {
        const w = arcTarget[i]!;
        if (done[w]) continue;
        const e = arcEdge[i]!;
        const t = time[v]! + seconds(e, lengthM(e));
        if (t < time[w]!) {
          time[w] = t;
          via[w] = i;
          heap.push(w, t + heuristic(w));
        }
      }
    }
    if (bestTime === Infinity) return null;

    const snap = { from: source.distance, to: target.distance };
    const coordinates: LngLat[] = [];
    const add = (point: LngLat): void => {
      const prev = coordinates.at(-1);
      if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) coordinates.push(point);
    };
    const linePoint = (q: number): LngLat => [this.lineLon[q]!, this.lineLat[q]!];
    // Primer punto del tramo en que cae cada punto ajustado.
    const sp = this.lineStart[source.edge]! + source.segment;
    const tp = this.lineStart[target.edge]! + target.segment;
    add(source.point);

    if (bestEnd < 0) {
      if (target.fraction >= source.fraction) for (let q = sp + 1; q <= tp; q++) add(linePoint(q));
      else for (let q = sp; q > tp; q--) add(linePoint(q));
      add(target.point);
      return { distance: Math.abs(target.fraction - source.fraction) * sL, duration: bestTime, coordinates, snap };
    }

    // Se reconstruye del destino al origen y se da vuelta al final.
    const arcs: number[] = [];
    let v = bestEnd;
    while (via[v]! >= 0) {
      const i = via[v]!;
      arcs.push(i);
      const e = arcEdge[i]!;
      v = reversed[i] ? edges[e * EDGE_STRIDE + 1]! : edges[e * EDGE_STRIDE]!;
    }
    arcs.reverse();
    // v es el vértice por el que se salió de la arista del origen.
    const leftToA = v === sa && (sa !== sb || leaveToA <= leaveToB);
    let distance = leftToA ? leaveToA : leaveToB;
    if (leftToA) for (let q = sp; q >= this.lineStart[source.edge]!; q--) add(linePoint(q));
    else for (let q = sp + 1; q < this.lineStart[source.edge + 1]!; q++) add(linePoint(q));
    for (const i of arcs) {
      const e = arcEdge[i]!;
      distance += lengthM(e);
      const inner = this.edgeGeometry(e);
      if (reversed[i]) inner.reverse();
      for (const point of inner) add(point);
      add(this.vertex(arcTarget[i]!));
    }
    distance += bestFromA ? arriveFromA : arriveFromB;
    if (bestFromA) for (let q = this.lineStart[target.edge]!; q <= tp; q++) add(linePoint(q));
    else for (let q = this.lineStart[target.edge + 1]! - 1; q > tp; q--) add(linePoint(q));
    add(target.point);
    return { distance, duration: bestTime, coordinates, snap };
  }

  private vertex(v: number): LngLat {
    return [this.lon[v]!, this.lat[v]!];
  }

  /** Puntos intermedios de una arista, en el sentido en que se guardó. */
  private edgeGeometry(e: number): LngLat[] {
    const { geometry, edges } = this.graph;
    const from = edges[e * EDGE_STRIDE]!;
    let x = Math.round(this.lon[from]! * SCALE);
    let y = Math.round(this.lat[from]! * SCALE);
    const points: LngLat[] = [];
    for (let k = this.edgeGeometryStart[e]!; k < this.edgeGeometryStart[e + 1]!; k++) {
      x += geometry[2 * k]!;
      y += geometry[2 * k + 1]!;
      points.push([x / SCALE, y / SCALE]);
    }
    return points;
  }
}

/**
 * Mayor componente fuertemente conexa (Kosaraju, iterativo para no agotar la
 * pila con redes grandes). Devuelve 1 para cada vértice que pertenece a ella.
 */
function mainComponent(start: Int32Array, target: Int32Array, hasArc: Uint8Array): Uint8Array {
  const count = hasArc.length;
  // 1. Orden de finalización de un DFS sobre el grafo.
  const order: number[] = [];
  const seen = new Uint8Array(count);
  const stack: number[] = [];
  const next = new Int32Array(count);
  for (let root = 0; root < count; root++) {
    if (seen[root] || !hasArc[root]) continue;
    seen[root] = 1;
    stack.push(root);
    next[root] = start[root]!;
    while (stack.length > 0) {
      const v = stack[stack.length - 1]!;
      if (next[v]! < start[v + 1]!) {
        const w = target[next[v]!++]!;
        if (!seen[w]) {
          seen[w] = 1;
          next[w] = start[w]!;
          stack.push(w);
        }
      } else {
        order.push(v);
        stack.pop();
      }
    }
  }
  // 2. Grafo transpuesto (CSR).
  const tStart = new Int32Array(count + 1);
  for (let i = 0; i < target.length; i++) tStart[target[i]! + 1]!++;
  for (let v = 0; v < count; v++) tStart[v + 1]! += tStart[v]!;
  const tFill = tStart.slice(0, count);
  const tTarget = new Int32Array(target.length);
  for (let v = 0; v < count; v++) {
    for (let i = start[v]!; i < start[v + 1]!; i++) tTarget[tFill[target[i]!]!++] = v;
  }
  // 3. DFS sobre el transpuesto en orden inverso de finalización: cada árbol es una componente.
  const component = new Int32Array(count).fill(-1);
  const sizes: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const root = order[k]!;
    if (component[root] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    component[root] = id;
    stack.push(root);
    while (stack.length > 0) {
      const v = stack.pop()!;
      size++;
      for (let i = tStart[v]!; i < tStart[v + 1]!; i++) {
        const w = tTarget[i]!;
        if (component[w] === -1) {
          component[w] = id;
          stack.push(w);
        }
      }
    }
    sizes.push(size);
  }
  let largest = -1;
  for (let id = 0; id < sizes.length; id++) if (largest < 0 || sizes[id]! > sizes[largest]!) largest = id;
  const main = new Uint8Array(count);
  for (let v = 0; v < count; v++) if (component[v] === largest && largest >= 0) main[v] = 1;
  return main;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

/** Montículo binario de mínimos: (vértice, prioridad). */
class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  /** Prioridad del primero en salir (con el montículo no vacío). */
  get minPriority(): number {
    return this.priorities[0]!;
  }

  push(item: number, priority: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.items[i] = this.items[parent]!;
      this.priorities[i] = this.priorities[parent]!;
      i = parent;
    }
    this.items[i] = item;
    this.priorities[i] = priority;
  }

  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    const n = this.items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= n) break;
        const right = left + 1;
        const child = right < n && this.priorities[right]! < this.priorities[left]! ? right : left;
        if (this.priorities[child]! >= lastPriority) break;
        this.items[i] = this.items[child]!;
        this.priorities[i] = this.priorities[child]!;
        i = child;
      }
      this.items[i] = lastItem;
      this.priorities[i] = lastPriority;
    }
    return top;
  }
}
