// El ejemplo "Usar el mapa en la app" del README es docs/ejemplos/mapa-app.ts:
// tsc lo verifica con maplibre-gl y pmtiles reales (make check) y esta prueba
// exige que el README muestre exactamente ese archivo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const readme = readFileSync("README.md", "utf8");
const example = readFileSync("docs/ejemplos/mapa-app.ts", "utf8");

describe("README", () => {
  it("el ejemplo para la app es docs/ejemplos/mapa-app.ts", () => {
    const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
    assert.ok(blocks.includes(example), "el bloque ```ts del README no coincide con docs/ejemplos/mapa-app.ts");
  });

  it("el ejemplo crea el mapa con la cámara del estilo y la región como límite", () => {
    // Sin center y zoom explícitos el mapa arranca en 0,0 z0 y puede quedar vacío (demo/demo.js).
    assert.match(example, /center: style\.center/);
    assert.match(example, /zoom: style\.zoom/);
    assert.match(example, /maxBounds: metadata\["veni:bounds"\]/);
  });
});
