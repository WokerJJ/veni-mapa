// El router que llega al navegador (vendor/rutas/) es el mismo de scripts/routing,
// en JavaScript: se importa como módulo sin tipos y calcula las mismas rutas.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";
import { buildGraph, parseOpl } from "../../scripts/routing/build.ts";
import { Router } from "../../scripts/routing/router.ts";
import { toBrowser } from "../../scripts/routing/browser.ts";

const run = promisify(execFile);

describe("router para el navegador", () => {
  const dir = mkdtempSync(join(tmpdir(), "rutas-js-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("genera graph.js y router.js sin tipos ni importaciones .ts", async () => {
    await run(process.execPath, ["--no-warnings", "scripts/routing/browser.ts", dir]);
    for (const name of ["graph", "router"]) {
      const js = readFileSync(join(dir, `${name}.js`), "utf8");
      assert.match(js, /^\/\/ Generado desde scripts\/routing\//);
      assert.doesNotMatch(js, /from "\.\/[^"]+\.ts"/);
      assert.doesNotMatch(js, /: RoutingGraph|interface Route/);
    }
    assert.match(readFileSync(join(dir, "router.js"), "utf8"), /from "\.\/graph\.js"/);
  });

  it("el router generado calcula las mismas rutas que el original", async () => {
    const js = (await import(pathToFileURL(join(dir, "router.js")).href)) as typeof import("../../scripts/routing/router.ts");
    const meta = { region: "p", osm_date: "20260928", source: "x", source_md5: "0".repeat(32), bbox: [0, 0, 0, 0] as [number, number, number, number], attribution: "© colaboradores de OpenStreetMap" };
    const graph = buildGraph(parseOpl(readFileSync("tests/fixtures/routing/red.opl", "utf8")), meta);
    const from: [number, number] = [-76.148, 4.41];
    const to: [number, number] = [-76.15, 4.41];
    for (const profile of ["foot", "car"] as const) {
      assert.deepEqual(new js.Router(graph).route(from, to, profile), new Router(graph).route(from, to, profile));
    }
  });

  it("falla si queda una importación .ts que el navegador no puede cargar", () => {
    assert.throws(() => toBrowser('import { x } from "../otro/cosa.ts";\n', "prueba"), /quedó una importación \.ts/);
  });
});
