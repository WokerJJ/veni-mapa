// Pruebas del servidor de `make serve`: rangos HTTP, rutas y métodos.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createHandler, parseRange, resolvePath } from "../../scripts/serve.ts";

describe("parseRange", () => {
  const cases: [string | undefined, ReturnType<typeof parseRange>][] = [
    [undefined, null],
    ["bytes=0-9", { start: 0, end: 9 }],
    ["bytes=90-", { start: 90, end: 99 }],
    ["bytes=-10", { start: 90, end: 99 }],
    ["bytes=-500", { start: 0, end: 99 }],
    ["bytes=50-500", { start: 50, end: 99 }],
    ["bytes=100-", "invalido"],
    ["bytes=9-3", "invalido"],
    ["bytes=-0", "invalido"],
    ["bytes=0-1,5-9", null],
    ["items=0-9", null],
    ["bytes=-", null],
  ];
  for (const [header, expected] of cases) {
    it(`${header ?? "sin Range"} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(parseRange(header, 100), expected);
    });
  }
});

describe("resolvePath", () => {
  const root = join(tmpdir(), "raiz");
  it("resuelve rutas dentro de la raíz", () => {
    assert.equal(resolvePath(root, "/fonts/Figtree%20Regular/0-255.pbf"), join(root, "fonts", "Figtree Regular", "0-255.pbf"));
  });
  for (const bad of ["/../secreto", "/%2e%2e/secreto", "/fonts/../../secreto", "/%00", "/%E0%A4%A"]) {
    it(`rechaza '${bad}'`, () => {
      assert.equal(resolvePath(root, bad), null);
    });
  }
});

describe("servidor", () => {
  const dir = mkdtempSync(join(tmpdir(), "veni-site-"));
  const body = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
  let server: Server;
  let base: string;

  before(async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "index.html"), "<h1>hola</h1>");
    writeFileSync(join(dir, "roldanillo.pmtiles"), body);
    writeFileSync(join(dir, "sub", "index.html"), "sub");
    writeFileSync(join(tmpdir(), "fuera-del-sitio.txt"), "secreto");
    server = createServer(createHandler(dir));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("responde 206 con el rango pedido, como necesita PMTiles", async () => {
    const res = await fetch(`${base}/roldanillo.pmtiles`, { headers: { Range: "bytes=10-19" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 10-19/100");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), body.subarray(10, 20));
  });

  it("responde 200 completo sin Range y anuncia Accept-Ranges", async () => {
    const res = await fetch(`${base}/roldanillo.pmtiles`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal((await res.arrayBuffer()).byteLength, 100);
  });

  it("responde 416 a un rango fuera del archivo", async () => {
    const res = await fetch(`${base}/roldanillo.pmtiles`, { headers: { Range: "bytes=200-300" } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), "bytes */100");
  });

  it("CORS abierto y cabeceras de rango expuestas", async () => {
    const res = await fetch(`${base}/roldanillo.pmtiles`, { method: "HEAD" });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-expose-headers") ?? "", /Content-Range/);
  });

  it("sirve index.html en la raíz y en carpetas", async () => {
    assert.equal(await (await fetch(`${base}/`)).text(), "<h1>hola</h1>");
    assert.equal(await (await fetch(`${base}/sub/`)).text(), "sub");
  });

  it("404 para lo que no existe y para rutas fuera del sitio", async () => {
    assert.equal((await fetch(`${base}/no-existe.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/fuera-del-sitio.txt`)).status, 404);
  });

  it("405 para métodos que no son GET ni HEAD", async () => {
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  });
});
