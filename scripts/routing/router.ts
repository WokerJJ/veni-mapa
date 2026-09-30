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
// Los puntos se ajustan al vértice más cercano de la red principal del perfil
// (su mayor componente fuertemente conexa: desde cualquiera de sus vértices se
// llega a todos los demás). Así un punto junto a una calle aislada o al final de
// un sentido único sin salida se ajusta a la red y siempre tiene ruta.
//
// Límites: los puntos se ajustan a un vértice (cruce o extremo de vía), no a un
// punto sobre la calle; no hay giros prohibidos, semáforos ni tráfico. Es para
// dibujar el camino, no para navegar paso a paso.
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
  /** Camino para dibujar, del vértice de salida al de llegada. */
  coordinates: LngLat[];
  /**
   * Metros entre cada punto pedido y el vértice al que se ajustó: la app puede
   * dibujar ese tramo aparte o avisar si es largo.
   */
  snap: { from: number; to: number };
}

/** Distancia máxima, en metros, entre un punto pedido y el vértice al que se ajusta. */
export const MAX_SNAP_M = 1000;

const CELL_DEG = 0.005; // ~550 m en Roldanillo

interface Adjacency {
  /** Arcos del vértice v: de start[v] a start[v + 1] en target, edge y reversed. */
  start: Int32Array;
  target: Int32Array;
  edge: Int32Array;
  reversed: Uint8Array;
  /** Vértices de la red principal, por celda de la grilla. */
  grid: Map<string, number[]>;
  /** Tamaño de la red principal y cantidad de vértices con algún arco. */
  network: { main: number; total: number };
}

export class Router {
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  private readonly graph: RoutingGraph;
  private readonly edgeGeometryStart: Int32Array;
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
    return { start, target, edge, reversed, grid, network: { main: mainCount, total: arcCount } };
  }

  /** Vértices de la red principal de un perfil y vértices con algún arco (para verificar el grafo). */
  network(profile: Profile): { main: number; total: number } {
    return { ...this.adjacency[profile].network };
  }

  /** Vértice más cercano a un punto para un perfil, o -1 si no hay ninguno a menos de MAX_SNAP_M. */
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

  /** Ruta más rápida entre dos puntos, o null si alguno no está cerca de una vía o no hay conexión. */
  route(from: LngLat, to: LngLat, profile: Profile): Route | null {
    const source = this.nearest(from, profile);
    const target = this.nearest(to, profile);
    if (source < 0 || target < 0) return null;
    const snap = {
      from: distanceM(from[0], from[1], this.lon[source]!, this.lat[source]!),
      to: distanceM(to[0], to[1], this.lon[target]!, this.lat[target]!),
    };
    const { start, target: arcTarget, edge: arcEdge, reversed } = this.adjacency[profile];
    const { edges } = this.graph;
    const maxSpeed = profile === "foot" ? FOOT_KMH / 3.6 : Math.max(...CLASSES.map((c) => c.carKmh ?? 0)) / 3.6;
    const speed = (cls: number): number => (profile === "foot" ? FOOT_KMH : CLASSES[cls]!.carKmh!) / 3.6;

    const count = this.lon.length;
    const time = new Float64Array(count).fill(Infinity);
    const via = new Int32Array(count).fill(-1); // arco por el que se llegó
    const done = new Uint8Array(count);
    const heuristic = (v: number): number =>
      distanceM(this.lon[v]!, this.lat[v]!, this.lon[target]!, this.lat[target]!) / maxSpeed;
    const heap = new MinHeap();
    time[source] = 0;
    heap.push(source, heuristic(source));

    while (heap.size > 0) {
      const v = heap.pop();
      if (done[v]) continue;
      done[v] = 1;
      if (v === target) break;
      for (let i = start[v]!; i < start[v + 1]!; i++) {
        const w = arcTarget[i]!;
        if (done[w]) continue;
        const e = arcEdge[i]!;
        const t = time[v]! + edges[e * EDGE_STRIDE + 2]! / 10 / speed(edges[e * EDGE_STRIDE + 4]!);
        if (t < time[w]!) {
          time[w] = t;
          via[w] = i;
          heap.push(w, t + heuristic(w));
        }
      }
    }
    if (!done[target]) return null;

    // Se reconstruye del destino al origen y se da vuelta al final.
    const arcs: number[] = [];
    for (let v = target; v !== source; ) {
      const i = via[v]!;
      arcs.push(i);
      const e = arcEdge[i]!;
      v = reversed[i] ? edges[e * EDGE_STRIDE + 1]! : edges[e * EDGE_STRIDE]!;
    }
    arcs.reverse();
    const coordinates: LngLat[] = [[this.lon[source]!, this.lat[source]!]];
    let distance = 0;
    for (const i of arcs) {
      const e = arcEdge[i]!;
      distance += edges[e * EDGE_STRIDE + 2]! / 10;
      const inner = this.edgeGeometry(e);
      if (reversed[i]) inner.reverse();
      coordinates.push(...inner, [this.lon[arcTarget[i]!]!, this.lat[arcTarget[i]!]!]);
    }
    return { distance, duration: time[target]!, coordinates, snap };
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
