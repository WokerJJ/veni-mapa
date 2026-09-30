// Los ejemplos de TypeScript del README son los archivos de docs/ejemplos: tsc
// los verifica con maplibre-gl y pmtiles reales (make check) y esta prueba exige
// que cada bloque ```ts del README sea uno de ellos, y que todos aparezcan.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const readme = readFileSync("README.md", "utf8");
const examples = new Map(
  readdirSync("docs/ejemplos")
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => [f, readFileSync(`docs/ejemplos/${f}`, "utf8")]),
);
const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!);

describe("README", () => {
  it("cada bloque ```ts es un archivo de docs/ejemplos", () => {
    const files = [...examples.values()];
    for (const block of blocks) {
      assert.ok(files.includes(block), `bloque sin archivo en docs/ejemplos:\n${block.slice(0, 200)}`);
    }
  });

  it("cada archivo de docs/ejemplos aparece en el README", () => {
    for (const [name, example] of examples) assert.ok(blocks.includes(example), `${name} no está en el README`);
  });

  it("el mapa se crea con la cámara del estilo y la región como límite", () => {
    // Sin center y zoom explícitos el mapa arranca en 0,0 z0 y puede quedar vacío (demo/demo.js).
    const example = examples.get("mapa-app.ts")!;
    assert.match(example, /center: style\.center/);
    assert.match(example, /zoom: style\.zoom/);
    assert.match(example, /maxBounds: metadata\["veni:bounds"\]/);
  });

  it("el grafo de rutas se descarga al pedir la primera ruta, no al abrir el mapa", () => {
    assert.match(examples.get("rutas-app.ts")!, /router \?\?= fetch\(import\.meta\.env\.VITE_MAP_ROUTES_URL\)/);
    // Un 404 o un corte no deja las rutas rotas hasta recargar.
    assert.match(examples.get("rutas-app.ts")!, /if \(!res\.ok\) throw/);
    assert.match(examples.get("rutas-app.ts")!, /router = undefined;/);
  });
});
