// Rutas conocidas sobre el grafo real de Roldanillo (make routing). No va con
// las pruebas de `make check` porque necesita los datos: la CI la corre después
// de make routing, y en local se corre con
//
//   docker compose run --rm tools node --test tests/data/rutas-roldanillo.test.ts
//
// Los rangos son amplios a propósito: OpenStreetMap cambia cada mes y la prueba
// busca errores del grafo (rutas imposibles, sentidos ignorados), no centímetros.
// Si una calle cambia de verdad en OSM, se ajusta aquí con el dato nuevo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { distanceM } from "../../scripts/routing/graph.ts";
import { Router, type LngLat } from "../../scripts/routing/router.ts";

const router = new Router(JSON.parse(readFileSync("build/routing/roldanillo-rutas.json", "utf8")));

// Lugares tomados de OpenStreetMap.
const ALCALDIA: LngLat = [-76.1543668, 4.4111559]; // node 13596229993
const MUSEO_RAYO: LngLat = [-76.1537, 4.4096]; // way 227606067
const VIA_PANORAMA: LngLat = [-76.1452394, 4.3981409]; // node 904367766, vía 36995244 (ref 23)
// Dos nodos de la way 110131603, calle residencial de sentido único hacia el oeste.
const ONEWAY_ESTE: LngLat = [-76.1528384, 4.4128313];
const ONEWAY_OESTE: LngLat = [-76.1543889, 4.4127813];

const straight = (a: LngLat, b: LngLat): number => distanceM(...a, ...b);

describe("rutas conocidas en Roldanillo", () => {
  it("de la Alcaldía al Museo Rayo, a pie y en carro: unas cuadras", () => {
    for (const perfil of ["foot", "car"] as const) {
      const ruta = router.route(ALCALDIA, MUSEO_RAYO, perfil);
      assert.ok(ruta, `${perfil}: sin ruta`);
      assert.ok(ruta.distance >= straight(ALCALDIA, MUSEO_RAYO) - 50 && ruta.distance < 600, `${perfil}: ${ruta.distance} m`);
    }
  });

  it("de la Alcaldía a la Vía Panorama: ~2 km, a pie ~25 min y en carro ~3 min", () => {
    const pie = router.route(ALCALDIA, VIA_PANORAMA, "foot")!;
    const carro = router.route(ALCALDIA, VIA_PANORAMA, "car")!;
    for (const ruta of [pie, carro]) {
      assert.ok(ruta.distance > straight(ALCALDIA, VIA_PANORAMA) && ruta.distance < 3000, `${ruta.distance} m`);
    }
    assert.ok(pie.duration > 15 * 60 && pie.duration < 40 * 60, `a pie ${pie.duration} s`);
    assert.ok(carro.duration > 60 && carro.duration < 10 * 60, `en carro ${carro.duration} s`);
  });

  it("sentido único: a favor, recto; en contra, el carro rodea y a pie no", () => {
    const recta = straight(ONEWAY_ESTE, ONEWAY_OESTE);
    const aFavor = router.route(ONEWAY_ESTE, ONEWAY_OESTE, "car")!;
    assert.ok(aFavor.distance < recta * 1.1, `a favor: ${aFavor.distance} m`);
    const enContra = router.route(ONEWAY_OESTE, ONEWAY_ESTE, "car")!;
    assert.ok(enContra.distance > recta * 2, `en contra: ${enContra.distance} m`);
    const aPie = router.route(ONEWAY_OESTE, ONEWAY_ESTE, "foot")!;
    assert.ok(aPie.distance < recta * 1.1, `a pie: ${aPie.distance} m`);
  });

  it("la ruta dibujada empieza y termina cerca de los puntos pedidos y no salta", () => {
    const ruta = router.route(ALCALDIA, VIA_PANORAMA, "foot")!;
    assert.ok(straight(ruta.coordinates[0]!, ALCALDIA) < 150);
    assert.ok(straight(ruta.coordinates.at(-1)!, VIA_PANORAMA) < 150);
    // Entre puntos consecutivos, nada más largo que una cuadra rural larga.
    for (let i = 1; i < ruta.coordinates.length; i++) {
      assert.ok(straight(ruta.coordinates[i - 1]!, ruta.coordinates[i]!) < 1000);
    }
    // La suma de los tramos dibujados es la distancia informada.
    let sum = 0;
    for (let i = 1; i < ruta.coordinates.length; i++) sum += straight(ruta.coordinates[i - 1]!, ruta.coordinates[i]!);
    assert.ok(Math.abs(sum - ruta.distance) < 5, `dibujada ${sum} m, informada ${ruta.distance} m`);
  });

  it("calcula rápido: menos de 50 ms por ruta", () => {
    const start = performance.now();
    for (let i = 0; i < 20; i++) router.route(ALCALDIA, VIA_PANORAMA, i % 2 ? "car" : "foot");
    assert.ok((performance.now() - start) / 20 < 50);
  });
});
