// Pruebas del grafo de rutas (scripts/routing): lectura de OPL, reglas de acceso,
// armado del grafo y la búsqueda de rutas. Usa una red de calles hecha a mano
// (tests/fixtures/routing/red.opl), con cuadras de ~111 m:
//
//   D ─── E ─── F        w2  doble sentido
//   │     ┊     │        w3 y w4 doble sentido, w5 (┊) peatonal
//   A ──→ B ──→ C        w1  sentido único de A a C, con dos nodos intermedios entre A y B
//
// w6 es una calle privada de A a E (nadie la usa) y w7, una calle aislada.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { promisify } from "node:util";
import { buildGraph, parseOpl } from "../../scripts/routing/build.ts";
import {
  CAR_BACKWARD,
  CAR_FORWARD,
  CLASSES,
  EDGE_STRIDE,
  FOOT_BACKWARD,
  FOOT_FORWARD,
  accessFlags,
  distanceM,
  type RoutingGraph,
} from "../../scripts/routing/graph.ts";
import { Router, type LngLat } from "../../scripts/routing/router.ts";

const run = promisify(execFile);

const opl = readFileSync("tests/fixtures/routing/red.opl", "utf8");
const meta = { region: "prueba", osm_date: "20260928", bbox: [-76.2, 4.4, -76.1, 4.5] as [number, number, number, number], attribution: "© colaboradores de OpenStreetMap" };
const graph = buildGraph(parseOpl(opl), meta);
const router = new Router(graph);

const A: LngLat = [-76.15, 4.41];
const B: LngLat = [-76.149, 4.41];
const C: LngLat = [-76.148, 4.41];
const E: LngLat = [-76.149, 4.411];
const ISLA: LngLat = [-76.14, 4.42];
const N10: LngLat = [-76.1495, 4.4101];
const N11: LngLat = [-76.1492, 4.4101];
const CUADRA = distanceM(...A, ...B);

const tags = (text: string): Map<string, string> => new Map(text.split(",").map((kv) => kv.split("=") as [string, string]));
const flags = (text: string): number => accessFlags(tags(text));

describe("lectura de OPL", () => {
  it("solo vías, con etiquetas sin escapar y coordenadas", () => {
    const ways = parseOpl(opl);
    assert.equal(ways.length, 8);
    assert.equal(ways[0]!.tags.get("name"), "Calle 7");
    assert.deepEqual(ways[0]!.nodes[1], { id: 10, lon: -76.1495, lat: 4.4101 });
  });

  it("un nodo sin coordenadas corta la vía en dos tramos", () => {
    const cut = parseOpl("w1 v1 Thighway=residential Nn1x-76.15y4.41,n2x-76.149y4.41,n3,n4x-76.147y4.41,n5x-76.146y4.41\n");
    const g = buildGraph(cut, meta);
    assert.equal(g.edges.length / EDGE_STRIDE, 2);
  });
});

describe("reglas de acceso", () => {
  it("doble sentido para los dos perfiles", () => {
    assert.equal(flags("highway=residential"), CAR_FORWARD | CAR_BACKWARD | FOOT_FORWARD | FOOT_BACKWARD);
  });

  it("sentido único: los carros en un sentido, a pie en los dos", () => {
    assert.equal(flags("highway=residential,oneway=yes"), CAR_FORWARD | FOOT_FORWARD | FOOT_BACKWARD);
    assert.equal(flags("highway=residential,oneway=-1"), CAR_BACKWARD | FOOT_FORWARD | FOOT_BACKWARD);
    assert.equal(flags("highway=residential,oneway=no"), CAR_FORWARD | CAR_BACKWARD | FOOT_FORWARD | FOOT_BACKWARD);
  });

  it("una glorieta es de sentido único aunque no lo diga", () => {
    assert.equal(flags("highway=tertiary,junction=roundabout") & (CAR_FORWARD | CAR_BACKWARD), CAR_FORWARD);
    assert.equal(flags("highway=tertiary,junction=roundabout,oneway=no") & CAR_BACKWARD, CAR_BACKWARD);
  });

  it("peatonales y senderos solo a pie; autopistas solo en vehículo", () => {
    assert.equal(flags("highway=footway"), FOOT_FORWARD | FOOT_BACKWARD);
    assert.equal(flags("highway=steps"), FOOT_FORWARD | FOOT_BACKWARD);
    assert.equal(flags("highway=motorway"), CAR_FORWARD);
    assert.equal(flags("highway=primary,motorroad=yes") & (FOOT_FORWARD | FOOT_BACKWARD), 0);
  });

  it("acceso privado o prohibido, con la etiqueta más específica mandando", () => {
    assert.equal(flags("highway=residential,access=private"), 0);
    assert.equal(flags("highway=residential,access=no,foot=yes"), FOOT_FORWARD | FOOT_BACKWARD);
    assert.equal(flags("highway=service,motor_vehicle=no") & (CAR_FORWARD | CAR_BACKWARD), 0);
    assert.equal(flags("highway=service,access=no,motorcar=destination") & CAR_FORWARD, CAR_FORWARD);
    assert.equal(flags("highway=path,foot=no"), 0);
  });

  it("lo que no es una vía transitable no entra", () => {
    assert.equal(flags("building=yes"), 0);
    assert.equal(flags("highway=construction"), 0);
    assert.equal(flags("highway=proposed"), 0);
    assert.equal(flags("highway=pedestrian,area=yes"), 0);
  });
});

describe("grafo", () => {
  it("vértices solo en cruces y extremos; los nodos intermedios quedan como geometría", () => {
    // A B C D E F y los dos extremos de la calle aislada; sin n10 ni n11, sin w6 ni w8.
    assert.equal(graph.nodes.length / 2, 8);
    assert.equal(graph.edges.length / EDGE_STRIDE, 8);
    assert.equal(graph.geometry_counts.reduce((a, b) => a + b, 0), 2);
    assert.equal(graph.geometry.length, 4);
  });

  it("metadatos: formato, fuente, atribución y licencia", () => {
    assert.equal(graph.format, "veni-rutas");
    assert.equal(graph.version, 1);
    assert.equal(graph.osm_date, "20260928");
    assert.equal(graph.attribution, "© colaboradores de OpenStreetMap");
    assert.equal(graph.license, "ODbL-1.0");
  });

  it("el mismo OPL da exactamente el mismo grafo", () => {
    assert.equal(JSON.stringify(buildGraph(parseOpl(opl), meta)), JSON.stringify(graph));
  });

  it("el router rechaza otro formato o versión", () => {
    assert.throws(() => new Router({ ...graph, version: 2 } as unknown as RoutingGraph), /formato no soportado/);
  });
});

describe("rutas", () => {
  it("en vehículo sigue el sentido único cuando va a favor", () => {
    const ruta = router.route(A, C, "car")!;
    assert.ok(ruta.distance > 2 * CUADRA && ruta.distance < 2 * CUADRA + 5, `distancia ${ruta.distance}`);
    // Pasa por los nodos intermedios de w1, en orden.
    assert.deepEqual(ruta.coordinates.slice(0, 4), [A, N10, N11, B]);
    assert.deepEqual(ruta.coordinates.at(-1), C);
  });

  it("en vehículo no toma el sentido único en contra: da la vuelta por arriba", () => {
    const ruta = router.route(C, A, "car")!;
    // C → F → E → D → A: cuatro cuadras (1 + 2 + 1).
    assert.ok(ruta.distance > 4 * CUADRA - 5 && ruta.distance < 4 * CUADRA + 5, `distancia ${ruta.distance}`);
    assert.deepEqual(ruta.coordinates[0], C);
    assert.deepEqual(ruta.coordinates.at(-1), A);
  });

  it("a pie el sentido único no aplica, y la geometría se recorre al revés", () => {
    const ruta = router.route(C, A, "foot")!;
    assert.ok(ruta.distance < 2 * CUADRA + 5, `distancia ${ruta.distance}`);
    assert.deepEqual(ruta.coordinates, [C, B, N11, N10, A]);
  });

  it("la peatonal solo sirve a pie", () => {
    assert.ok(router.route(B, E, "foot")!.distance < CUADRA + 1);
    // En carro: B → C → F → E.
    const car = router.route(B, E, "car")!;
    assert.ok(car.distance > 3 * CUADRA - 5, `distancia ${car.distance}`);
  });

  it("nadie usa la calle privada", () => {
    for (const perfil of ["foot", "car"] as const) {
      const ruta = router.route(A, E, perfil)!;
      assert.ok(ruta.distance > 2 * CUADRA - 5, `${perfil}: ${ruta.distance}`);
    }
  });

  it("sin conexión, ruta vacía (null)", () => {
    assert.equal(router.route(A, ISLA, "car"), null);
    assert.equal(router.route(A, ISLA, "foot"), null);
  });

  it("un punto a más de 1 km de cualquier vía no se ajusta", () => {
    // 2,2 km al sur de A (y más lejos aún de la calle aislada).
    assert.equal(router.route([-76.15, 4.39], C, "foot"), null);
    // A unos 50 m de A sí: se ajusta a A.
    assert.deepEqual(router.route([-76.1504, 4.4098], C, "car")?.coordinates[0], A);
  });

  it("el mismo punto: ruta de largo cero", () => {
    const ruta = router.route(A, A, "car")!;
    assert.equal(ruta.distance, 0);
    assert.deepEqual(ruta.coordinates, [A]);
  });

  it("A* encuentra la ruta más rápida: igual que Dijkstra en una grilla con vías de distinta velocidad", () => {
    // Grilla de 12 × 12 con tipos de vía y sentidos únicos pseudoaleatorios (fijos).
    let seed = 7;
    const random = (): number => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const kinds = ["primary", "secondary", "residential", "track", "service"];
    const n = 12;
    const id = (x: number, y: number): number => 1000 + y * n + x;
    const node = (x: number, y: number): string => `n${id(x, y)}x${(-76.2 + x * 0.001).toFixed(4)}y${(4.4 + y * 0.001).toFixed(4)}`;
    const lines: string[] = [];
    let way = 1;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          if (x + dx >= n || y + dy >= n) continue;
          const oneway = random() < 0.2 ? ",oneway=yes" : "";
          const kind = kinds[Math.floor(random() * kinds.length)]!;
          lines.push(`w${way++} v1 Thighway=${kind}${oneway} N${node(x, y)},${node(x + dx, y + dy)}`);
        }
      }
    }
    const g = buildGraph(parseOpl(lines.join("\n")), meta);
    const r = new Router(g);

    // Dijkstra simple, sin heurística, sobre las mismas aristas.
    const speed = (cls: number): number => CLASSES[cls]!.carKmh! / 3.6;
    const dijkstra = (s: number, t: number): number => {
      const best = new Map<number, number>([[s, 0]]);
      const open = new Set([s]);
      while (open.size > 0) {
        const v = [...open].reduce((a, b) => (best.get(a)! <= best.get(b)! ? a : b));
        open.delete(v);
        if (v === t) return best.get(v)!;
        for (let e = 0; e < g.edges.length / EDGE_STRIDE; e++) {
          const [a, b, dm, fl, cls] = g.edges.slice(e * EDGE_STRIDE, e * EDGE_STRIDE + EDGE_STRIDE) as [number, number, number, number, number];
          const cost = dm / 10 / speed(cls);
          for (const [from, to, ok] of [[a, b, fl & CAR_FORWARD], [b, a, fl & CAR_BACKWARD]] as const) {
            if (from !== v || !ok) continue;
            const t2 = best.get(v)! + cost;
            if (t2 < (best.get(to) ?? Infinity)) {
              best.set(to, t2);
              open.add(to);
            }
          }
        }
      }
      return Infinity;
    };

    const corners: LngLat[] = [[-76.2, 4.4], [-76.189, 4.411], [-76.2, 4.411], [-76.189, 4.4], [-76.195, 4.405]];
    for (const from of corners) {
      for (const to of corners) {
        const ruta = r.route(from, to, "car");
        const expected = dijkstra(r.nearest(from, "car"), r.nearest(to, "car"));
        if (expected === Infinity) assert.equal(ruta, null);
        else assert.ok(Math.abs(ruta!.duration - expected) < 1e-6, `${from} → ${to}: A* ${ruta?.duration}, Dijkstra ${expected}`);
      }
    }
  });

  it("la duración usa la velocidad del perfil", () => {
    const ruta = router.route(C, A, "foot")!;
    assert.ok(Math.abs(ruta.duration - ruta.distance / (4.5 / 3.6)) < 1);
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "rutas-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("escribe el grafo desde el OPL y source.json", async () => {
    const source = join(dir, "source.json");
    writeFileSync(source, JSON.stringify({ region: "prueba", osm_date: "20260928", bbox: meta.bbox }));
    const out = join(dir, "rutas.json");
    const { stdout } = await run(process.execPath, ["scripts/routing/build.ts", "--opl", "tests/fixtures/routing/red.opl", "--source", source, "--out", out]);
    assert.match(stdout, /8 vértices, 8 aristas/);
    assert.equal(readFileSync(out, "utf8"), JSON.stringify(graph));
  });

  it("falla si no hay vías transitables", async () => {
    const empty = join(dir, "vacio.opl");
    writeFileSync(empty, "w1 v1 Tbuilding=yes Nn1x0y0,n2x1y1\n");
    const source = join(dir, "source.json");
    await assert.rejects(
      run(process.execPath, ["scripts/routing/build.ts", "--opl", empty, "--source", source, "--out", join(dir, "x.json")]),
      /no tiene vías transitables/,
    );
  });
});
