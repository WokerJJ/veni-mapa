// Pruebas del grafo de rutas (scripts/routing): lectura de OPL, reglas de acceso,
// armado del grafo y la búsqueda de rutas. Usa una red de calles hecha a mano
// (tests/fixtures/routing/red.opl), con cuadras de ~111 m:
//
//   D ─── E ─── F        w2  doble sentido
//   │     ┊     │        w3 y w4 doble sentido, w5 (┊) peatonal
//   A ──→ B ──→ C        w1  sentido único de A a C, con dos nodos intermedios entre A y B
//
// w6 es una calle privada de A a E (nadie la usa), w7 una calle aislada lejos y
// w9 una calle aislada a ~30 m de A, más cerca de algunos puntos que la red.
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
const meta = {
  region: "prueba",
  osm_date: "20260928",
  source: "https://download.geofabrik.de/south-america/colombia-260928.osm.pbf",
  source_md5: "0123456789abcdef0123456789abcdef",
  bbox: [-76.2, 4.4, -76.1, 4.5] as [number, number, number, number],
  attribution: "© colaboradores de OpenStreetMap",
};
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
    assert.equal(ways.length, 9);
    assert.equal(ways[0]!.tags.get("name"), "Calle 7");
    assert.deepEqual(ways[0]!.nodes[1], { id: 10, lon: -76.1495, lat: 4.4101 });
  });

  it("un nodo sin coordenadas es un error: osmium tuvo que dejar la ubicación de cada nodo", () => {
    // Así lo escribe osmium add-locations-to-ways con --ignore-missing-nodes.
    assert.throws(
      () => parseOpl("w7 v1 Thighway=residential Nn1x-76.15y4.41,n3xy,n4x-76.147y4.41\n"),
      /la vía w7 tiene el nodo n3 sin coordenadas/,
    );
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

  it("sentidos únicos: oneway=reverse, oneway:foot y los implícitos", () => {
    assert.equal(flags("highway=residential,oneway=reverse") & (CAR_FORWARD | CAR_BACKWARD), CAR_BACKWARD);
    assert.equal(flags("highway=footway,oneway:foot=yes"), FOOT_FORWARD);
    assert.equal(flags("highway=residential,oneway:foot=-1") & (FOOT_FORWARD | FOOT_BACKWARD), FOOT_BACKWARD);
    assert.equal(flags("highway=motorway_link"), CAR_FORWARD);
    assert.equal(flags("highway=tertiary,junction=circular") & (CAR_FORWARD | CAR_BACKWARD), CAR_FORWARD);
  });

  it("la etiqueta de acceso más específica manda sobre la general", () => {
    assert.equal(flags("highway=service,vehicle=no,motorcar=yes") & CAR_FORWARD, CAR_FORWARD);
    assert.equal(flags("highway=service,access=yes,motor_vehicle=no") & CAR_FORWARD, 0);
    assert.equal(flags("highway=primary,foot=use_sidepath") & (FOOT_FORWARD | FOOT_BACKWARD), 0);
    assert.equal(flags("highway=track,access=agricultural,foot=yes"), FOOT_FORWARD | FOOT_BACKWARD);
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
    // A B C D E F y los extremos de las dos calles aisladas; sin n10 ni n11, sin w6 ni w8.
    assert.equal(graph.nodes.length / 2, 10);
    assert.equal(graph.edges.length / EDGE_STRIDE, 9);
    assert.equal(graph.geometry_counts.reduce((a, b) => a + b, 0), 2);
    assert.equal(graph.geometry.length, 4);
  });

  it("metadatos: formato, fuente, atribución y licencia", () => {
    assert.equal(graph.format, "veni-rutas");
    assert.equal(graph.version, 1);
    assert.equal(graph.osm_date, "20260928");
    assert.equal(graph.source, meta.source);
    assert.equal(graph.source_md5, meta.source_md5);
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

  it("un punto más cerca de una calle aislada que de la red se ajusta a la red", () => {
    // A ~10 m de w9 (aislada) y a ~50 m de A.
    const cerca: LngLat = [-76.1504, 4.4097];
    for (const perfil of ["foot", "car"] as const) {
      const ruta = router.route(cerca, C, perfil);
      assert.ok(ruta, `${perfil}: sin ruta`);
      assert.deepEqual(ruta.coordinates[0], A);
      // Informa cuánto se movió cada punto al ajustarlo.
      assert.ok(Math.abs(ruta.snap.from - distanceM(...cerca, ...A)) < 0.5, `${perfil}: snap ${ruta.snap.from}`);
      assert.equal(ruta.snap.to, 0);
    }
  });

  it("la red principal: cuántos vértices quedan fuera por perfil", () => {
    // A pie: A-F más la peatonal (6) de 10 con arcos; en carro, los mismos 6.
    assert.deepEqual(router.network("foot"), { main: 6, total: 10 });
    assert.deepEqual(router.network("car"), { main: 6, total: 10 });
  });

  it("un sumidero de sentido único no es destino de ajuste", () => {
    // Una calle de sentido único que sale de la red y no vuelve: su extremo es
    // alcanzable pero no se puede salir de él, así que no entra a la red principal.
    const g = buildGraph(parseOpl(opl + "w20 v1 Thighway=residential,oneway=yes Nn3x-76.148y4.41,n50x-76.147y4.4095\n"), meta);
    const r = new Router(g);
    assert.deepEqual(r.network("car"), { main: 6, total: 11 });
    assert.deepEqual(r.route([-76.1471, 4.4095], A, "car")?.coordinates[0], C);
  });

  it("una vía cerrada con una sola conexión (glorieta con una entrada) sigue en el grafo", () => {
    // Glorieta G1 → G2 → G3 → G1 conectada a C por una sola calle.
    const glorieta =
      "w30 v1 Thighway=tertiary,junction=roundabout Nn60x-76.1470y4.4100,n61x-76.1465y4.4103,n62x-76.1465y4.4097,n60x-76.1470y4.4100\n" +
      "w31 v1 Thighway=tertiary Nn3x-76.148y4.41,n60x-76.1470y4.4100\n";
    const r = new Router(buildGraph(parseOpl(opl + glorieta), meta));
    // G2, el nodo del medio de la glorieta, es vértice: se puede llegar a él.
    const ruta = r.route(A, [-76.1465, 4.4103], "car");
    assert.ok(ruta, "sin ruta a la glorieta");
    assert.deepEqual(ruta.coordinates.at(-1), [-76.1465, 4.4103]);
    assert.equal(ruta.snap.to, 0);
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

    // Dijkstra simple, sin heurística, sobre las mismas aristas: desde los
    // extremos de la arista del origen, con el costo del tramo parcial de salida.
    const speed = (cls: number): number => CLASSES[cls]!.carKmh! / 3.6;
    const dijkstra = (starts: [number, number][]): Map<number, number> => {
      const best = new Map<number, number>();
      for (const [s, t0] of starts) if (t0 < (best.get(s) ?? Infinity)) best.set(s, t0);
      const open = new Set(best.keys());
      while (open.size > 0) {
        const v = [...open].reduce((a, b) => (best.get(a)! <= best.get(b)! ? a : b));
        open.delete(v);
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
      return best;
    };
    // Tiempo más corto entre dos puntos ajustados: por la red, saliendo y
    // entrando por los extremos que permite el sentido (un tramo de largo cero
    // vale en cualquier sentido), o directo si están en la misma arista.
    const expected = (from: LngLat): ((to: LngLat) => number) => {
      const s = r.snap(from, "car")!;
      const arista = (e: number) => {
        const [a, b, dm, fl, cls] = g.edges.slice(e * EDGE_STRIDE, e * EDGE_STRIDE + EDGE_STRIDE) as [number, number, number, number, number];
        return { a, b, fl, seconds: (fraction: number): number => (fraction * dm) / 10 / speed(cls) };
      };
      const se = arista(s.edge);
      const best = dijkstra([
        [se.a, se.fl & CAR_BACKWARD || s.fraction === 0 ? se.seconds(s.fraction) : Infinity],
        [se.b, se.fl & CAR_FORWARD || s.fraction === 1 ? se.seconds(1 - s.fraction) : Infinity],
      ]);
      return (to) => {
        const t = r.snap(to, "car")!;
        const te = arista(t.edge);
        let result = Math.min(
          (best.get(te.a) ?? Infinity) + (te.fl & CAR_FORWARD || t.fraction === 0 ? te.seconds(t.fraction) : Infinity),
          (best.get(te.b) ?? Infinity) + (te.fl & CAR_BACKWARD || t.fraction === 1 ? te.seconds(1 - t.fraction) : Infinity),
        );
        if (s.edge === t.edge) {
          const delta = t.fraction - s.fraction;
          if (delta === 0 || (delta > 0 && se.fl & CAR_FORWARD) || (delta < 0 && se.fl & CAR_BACKWARD)) {
            result = Math.min(result, se.seconds(Math.abs(delta)));
          }
        }
        return result;
      };
    };

    // Esquinas y puntos a mitad de cuadra, dos de ellos en la misma cuadra (fila 2, entre x = 1 y 2).
    const corners: LngLat[] = [[-76.2, 4.4], [-76.189, 4.411], [-76.2, 4.411], [-76.189, 4.4], [-76.195, 4.405]];
    const midBlock: LngLat[] = [[-76.1945, 4.405], [-76.1903, 4.4071], [-76.1982, 4.402], [-76.1987, 4.402], [-76.193, 4.4084]];
    const points = [...corners, ...midBlock];
    assert.equal(r.snap(midBlock[2]!, "car")!.edge, r.snap(midBlock[3]!, "car")!.edge, "los dos puntos de la misma cuadra");
    for (const from of points) {
      const desde = expected(from);
      for (const to of points) {
        const ruta = r.route(from, to, "car");
        const want = desde(to);
        if (want === Infinity) assert.equal(ruta, null);
        else assert.ok(Math.abs(ruta!.duration - want) < 1e-6, `${from} → ${to}: A* ${ruta?.duration}, Dijkstra ${want}`);
      }
    }
  });

  it("la duración usa la velocidad del perfil", () => {
    const ruta = router.route(C, A, "foot")!;
    assert.ok(Math.abs(ruta.duration - ruta.distance / (4.5 / 3.6)) < 1);
  });
});

describe("ajuste a la calle", () => {
  // Una manzana larga, con una calle sin salida que baja desde la calle de arriba:
  //
  //   P3 ──────── Q1 ──────── P4      w101
  //   │           │           │       w102 y w103 a los lados
  //   │           Q2          │       w104, sin salida (Q2 a ~55 m de la de abajo)
  //   P1 ──────────────────── P2      w100, ~1,1 km sin cruces
  const P1: LngLat = [-76.16, 4.43];
  const P2: LngLat = [-76.15, 4.43];
  const P3: LngLat = [-76.16, 4.432];
  const P4: LngLat = [-76.15, 4.432];
  const Q1: LngLat = [-76.155, 4.432];
  const Q2: LngLat = [-76.155, 4.4305];
  const manzana = (abajo: string): Router => {
    const node = (id: number, [x, y]: LngLat): string => `n${id}x${x}y${y}`;
    const lines = [
      `w100 v1 Thighway=residential${abajo} N${node(200, P1)},${node(201, P2)}`,
      `w101 v1 Thighway=residential N${node(202, P3)},${node(204, Q1)},${node(203, P4)}`,
      `w102 v1 Thighway=residential N${node(200, P1)},${node(202, P3)}`,
      `w103 v1 Thighway=residential N${node(201, P2)},${node(203, P4)}`,
      `w104 v1 Thighway=residential N${node(204, Q1)},${node(205, Q2)}`,
    ];
    return new Router(buildGraph(parseOpl(lines.join("\n")), meta));
  };
  const cerca = (a: LngLat, b: LngLat): boolean => distanceM(...a, ...b) < 0.5;
  const largo = (...puntos: LngLat[]): number => puntos.slice(1).reduce((m, p, i) => m + distanceM(...puntos[i]!, ...p), 0);

  it("un destino a mitad de una calle larga se ajusta a la calle, no a la calle sin salida vecina", () => {
    const r = manzana("");
    // A ~11 m de la calle de abajo y a ~45 m de Q2, el vértice más cercano.
    const destino: LngLat = [-76.1549, 4.4301];
    const v = r.nearest(destino, "car");
    assert.deepEqual([r.lon[v], r.lat[v]], Q2);
    const sobreLaCalle: LngLat = [-76.1549, 4.43];
    for (const perfil of ["foot", "car"] as const) {
      const ruta = r.route(P1, destino, perfil)!;
      assert.ok(cerca(ruta.coordinates.at(-1)!, sobreLaCalle), `${perfil}: termina en ${ruta.coordinates.at(-1)}`);
      // Derecho por la calle de abajo: sin dar la vuelta a la manzana.
      assert.equal(ruta.coordinates.length, 2, `${perfil}: ${JSON.stringify(ruta.coordinates)}`);
      assert.ok(Math.abs(ruta.distance - largo(P1, sobreLaCalle)) < 2, `${perfil}: distancia ${ruta.distance}`);
      assert.ok(Math.abs(ruta.snap.to - distanceM(...destino, ...sobreLaCalle)) < 0.5, `${perfil}: snap ${ruta.snap.to}`);
      assert.equal(ruta.snap.from, 0);
    }
  });

  it("origen y destino en la misma arista: el tramo directo", () => {
    const r = manzana("");
    const desde: LngLat = [-76.158, 4.4301];
    const hasta: LngLat = [-76.152, 4.4299];
    for (const perfil of ["foot", "car"] as const) {
      for (const [a, b] of [[desde, hasta], [hasta, desde]] as const) {
        const ruta = r.route(a, b, perfil)!;
        assert.equal(ruta.coordinates.length, 2, `${perfil}: ${JSON.stringify(ruta.coordinates)}`);
        assert.ok(cerca(ruta.coordinates[0]!, [a[0], 4.43]) && cerca(ruta.coordinates[1]!, [b[0], 4.43]));
        assert.ok(Math.abs(ruta.distance - distanceM(a[0], 4.43, b[0], 4.43)) < 2, `${perfil}: distancia ${ruta.distance}`);
      }
    }
  });

  it("en vehículo, el sentido único decide por qué extremo se sale y si vale el tramo directo", () => {
    const r = manzana(",oneway=yes"); // de P1 a P2
    const oeste: LngLat = [-76.158, 4.4301];
    const este: LngLat = [-76.152, 4.4301];
    const o: LngLat = [oeste[0], 4.43];
    const e: LngLat = [este[0], 4.43];
    // A favor: directo, en los dos perfiles.
    for (const perfil of ["foot", "car"] as const) {
      assert.ok(Math.abs(r.route(oeste, este, perfil)!.distance - largo(o, e)) < 2, perfil);
    }
    // En contra, a pie: directo.
    const aPie = r.route(este, oeste, "foot")!;
    assert.equal(aPie.coordinates.length, 2);
    assert.ok(Math.abs(aPie.distance - largo(e, o)) < 2, `a pie ${aPie.distance}`);
    // En contra, en carro: sale hacia P2 y da la vuelta por arriba.
    const carro = r.route(este, oeste, "car")!;
    const vuelta = largo(e, P2, P4, Q1, P3, P1, o);
    assert.ok(Math.abs(carro.distance - vuelta) < 3, `en carro ${carro.distance}, se espera ${vuelta}`);
    assert.ok(cerca(carro.coordinates[0]!, e) && cerca(carro.coordinates[1]!, P2), JSON.stringify(carro.coordinates));
    assert.ok(cerca(carro.coordinates.at(-2)!, P1) && cerca(carro.coordinates.at(-1)!, o));
  });

  it("a menos de 2 m de un cruce cuenta como el cruce: el sentido único no obliga a rodear", () => {
    const r = manzana(",oneway=yes"); // de P1 a P2
    // ~0,4 m al este de P1, sobre la de sentido único: en rigor habría que seguir hasta P2.
    const casiP1: LngLat = [-76.159996, 4.43];
    const ruta = r.route(casiP1, P3, "car")!;
    assert.ok(Math.abs(ruta.distance - largo(P1, P3)) < 1, `distancia ${ruta.distance}`);
    assert.deepEqual(ruta.coordinates, [P1, P3]);
    assert.ok(Math.abs(ruta.snap.from - distanceM(...casiP1, ...P1)) < 0.05, `snap ${ruta.snap.from}`);
  });

  it("la distancia de la ruta es la suma de los tramos dibujados", () => {
    const r = manzana(",oneway=yes");
    for (const perfil of ["foot", "car"] as const) {
      const ruta = r.route([-76.1531, 4.4318], [-76.1587, 4.4302], perfil)!;
      assert.ok(Math.abs(largo(...ruta.coordinates) - ruta.distance) < 2, `${perfil}: ${ruta.distance}`);
    }
  });

  it("en vehículo, a menos de 2 m del final de un sentido único se llega por el cruce, sin rodear", () => {
    const r = manzana(",oneway=yes"); // de P1 a P2
    // ~0,4 m al oeste de P2: en rigor habría que entrar por P1 y recorrer toda la calle de abajo.
    const casiP2: LngLat = [-76.150004, 4.43];
    const ruta = r.route(Q1, casiP2, "car")!;
    assert.ok(Math.abs(ruta.distance - largo(Q1, P4, P2)) < 1, `distancia ${ruta.distance}, se espera ${largo(Q1, P4, P2)}`);
    assert.deepEqual(ruta.coordinates, [Q1, P4, P2]);
  });

  it("en vehículo, contra el sentido único no vale el tramo directo por la misma arista", () => {
    const r = manzana(",oneway=-1"); // de P2 a P1
    const o: LngLat = [-76.158, 4.43];
    const e: LngLat = [-76.152, 4.43];
    const carro = r.route(o, e, "car")!;
    // Sale hacia P1 (a favor) y da la vuelta por arriba para entrar por P2.
    assert.notEqual(carro.coordinates.length, 2, JSON.stringify(carro.coordinates));
    const vuelta = largo(o, P1, P3, Q1, P4, P2, e);
    assert.ok(Math.abs(carro.distance - vuelta) < 3, `en carro ${carro.distance}, se espera ${vuelta}`);
    assert.ok(cerca(carro.coordinates[1]!, P1) && cerca(carro.coordinates.at(-2)!, P2), JSON.stringify(carro.coordinates));
    // A pie sí es el tramo directo.
    assert.equal(r.route(o, e, "foot")!.coordinates.length, 2);
  });

  it("un punto a ~900 m de una vía larga sin cruces tiene ruta aunque no haya un vértice a menos de 1 km", () => {
    // Una sola vía de ~4,4 km: sus dos vértices quedan a más de 2 km del punto.
    const r = new Router(buildGraph(parseOpl("w300 v1 Thighway=residential Nn300x-76.3y4.45,n301x-76.26y4.45\n"), meta));
    const lejos: LngLat = [-76.28, 4.4581];
    const sobreLaVia: LngLat = [-76.27, 4.45];
    for (const perfil of ["foot", "car"] as const) {
      // nearest (obsoleto) busca vértices: no encuentra ninguno y no sirve para decidir la cercanía.
      assert.equal(r.nearest(lejos, perfil), -1);
      const ajuste = r.snap(lejos, perfil);
      assert.ok(ajuste, `${perfil}: sin ajuste`);
      assert.ok(ajuste.distance > 850 && ajuste.distance < 950, `${perfil}: ajuste a ${ajuste.distance} m`);
      assert.ok(r.route(lejos, sobreLaVia, perfil), `${perfil}: sin ruta`);
    }
  });
});

describe("ajuste a la calle: puntos a mitad de una arista con puntos intermedios", () => {
  // La calle de abajo tiene tres puntos intermedios, así que cada punto ajustado
  // cae en un tramo (segment) de 0 a 3:
  //
  //   P3 ───────────────────────── P4      w111
  //   │                            │       w112 y w113 a los lados
  //   P1 ── M1 ── M2 ── M3 ──────── P2      w110, doble sentido
  const P1: LngLat = [-76.16, 4.43];
  const M1: LngLat = [-76.1575, 4.4302];
  const M2: LngLat = [-76.155, 4.4298];
  const M3: LngLat = [-76.1525, 4.4302];
  const P2: LngLat = [-76.15, 4.43];
  const P3: LngLat = [-76.16, 4.432];
  const P4: LngLat = [-76.15, 4.432];
  const node = (id: number, [x, y]: LngLat): string => `n${id}x${x}y${y}`;
  const r = new Router(
    buildGraph(
      parseOpl(
        [
          `w110 v1 Thighway=residential N${node(400, P1)},${node(410, M1)},${node(411, M2)},${node(412, M3)},${node(401, P2)}`,
          `w111 v1 Thighway=residential N${node(402, P3)},${node(403, P4)}`,
          `w112 v1 Thighway=residential N${node(400, P1)},${node(402, P3)}`,
          `w113 v1 Thighway=residential N${node(401, P2)},${node(403, P4)}`,
        ].join("\n"),
      ),
      meta,
    ),
  );
  const largo = (...puntos: LngLat[]): number => puntos.slice(1).reduce((m, p, i) => m + distanceM(...puntos[i]!, ...p), 0);
  // Junto a la calle de abajo, en los tramos 1 (M1-M2) y 2 (M2-M3), y en los lados cerca de P1 y P2.
  const enTramo1: LngLat = [-76.156, 4.4296];
  const enTramo2: LngLat = [-76.1535, 4.4296];
  const izquierda: LngLat = [-76.1601, 4.4305];
  const derecha: LngLat = [-76.1499, 4.4305];

  for (const perfil of ["foot", "car"] as const) {
    const punto = (p: LngLat): LngLat => r.snap(p, perfil)!.point;

    it(`${perfil}: los puntos ajustados caen en los tramos 1 y 2 de la arista`, () => {
      assert.equal(r.snap(enTramo1, perfil)!.segment, 1);
      assert.equal(r.snap(enTramo2, perfil)!.segment, 2);
    });

    it(`${perfil}: misma arista, del tramo 1 al 2 y al revés, pasando por M2`, () => {
      const [t1, t2] = [punto(enTramo1), punto(enTramo2)];
      const ida = r.route(enTramo1, enTramo2, perfil)!;
      assert.deepEqual(ida.coordinates, [t1, M2, t2]);
      assert.ok(Math.abs(ida.distance - largo(t1, M2, t2)) < 1, `ida ${ida.distance}`);
      const vuelta = r.route(enTramo2, enTramo1, perfil)!;
      assert.deepEqual(vuelta.coordinates, [t2, M2, t1]);
      assert.ok(Math.abs(vuelta.distance - largo(t2, M2, t1)) < 1, `vuelta ${vuelta.distance}`);
    });

    it(`${perfil}: se llega a mitad de la arista por cualquiera de sus extremos, con sus puntos intermedios`, () => {
      const [t1, t2, izq, der] = [punto(enTramo1), punto(enTramo2), punto(izquierda), punto(derecha)];
      // Por P1 (el vértice desde de la arista).
      assert.deepEqual(r.route(izquierda, enTramo1, perfil)!.coordinates, [izq, P1, M1, t1]);
      assert.deepEqual(r.route(izquierda, enTramo2, perfil)!.coordinates, [izq, P1, M1, M2, t2]);
      // Por P2 (el vértice hasta).
      assert.deepEqual(r.route(derecha, enTramo2, perfil)!.coordinates, [der, P2, M3, t2]);
      assert.deepEqual(r.route(derecha, enTramo1, perfil)!.coordinates, [der, P2, M3, M2, t1]);
    });

    it(`${perfil}: se sale de mitad de la arista por cualquiera de sus extremos, con sus puntos intermedios`, () => {
      const [t1, t2, izq, der] = [punto(enTramo1), punto(enTramo2), punto(izquierda), punto(derecha)];
      // Hacia P1.
      assert.deepEqual(r.route(enTramo1, izquierda, perfil)!.coordinates, [t1, M1, P1, izq]);
      assert.deepEqual(r.route(enTramo2, izquierda, perfil)!.coordinates, [t2, M2, M1, P1, izq]);
      // Hacia P2.
      assert.deepEqual(r.route(enTramo2, derecha, perfil)!.coordinates, [t2, M3, P2, der]);
      const ruta = r.route(enTramo1, derecha, perfil)!;
      assert.deepEqual(ruta.coordinates, [t1, M2, M3, P2, der]);
      assert.ok(Math.abs(ruta.distance - largo(...ruta.coordinates)) < 1, `distancia ${ruta.distance}`);
    });
  }
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "rutas-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("escribe el grafo desde el OPL y source.json", async () => {
    const source = join(dir, "source.json");
    writeFileSync(source, JSON.stringify({ region: "prueba", osm_date: "20260928", source: meta.source, source_md5: meta.source_md5, bbox: meta.bbox }));
    const out = join(dir, "rutas.json");
    const { stdout } = await run(process.execPath, ["scripts/routing/build.ts", "--opl", "tests/fixtures/routing/red.opl", "--source", source, "--out", out]);
    assert.match(stdout, /10 vértices, 9 aristas/);
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
