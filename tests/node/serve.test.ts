// Pruebas del servidor de `make serve`: rangos HTTP, rutas, métodos y robustez.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createHandler, parseRange, resolvePath } from "../../scripts/serve.ts";

describe("parseRange", () => {
  const cases: [string | undefined, ReturnType<typeof parseRange>][] = [
    [undefined, null],
    ["bytes=0-9", { start: 0, end: 9 }],
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=90-", { start: 90, end: 99 }],
    ["bytes=-10", { start: 90, end: 99 }],
    ["bytes=-500", { start: 0, end: 99 }],
    ["bytes=50-500", { start: 50, end: 99 }],
    ["bytes=100-", "invalido"],
    ["bytes=9-3", "invalido"],
    ["bytes=-0", "invalido"],
    ["bytes=0-1,5-9", null],
    ["bytes=0-1, 3-3", null],
    ["items=0-9", null],
    ["bytes=-", null],
  ];
  for (const [header, expected] of cases) {
    it(`${header ?? "sin Range"} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(parseRange(header, 100), expected);
    });
  }
  for (const header of ["bytes=-1", "bytes=0-", "bytes=0-0"]) {
    it(`archivo vacío: ${header} no es satisfacible`, () => {
      assert.equal(parseRange(header, 0), "invalido");
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

// Petición sin normalizar la ruta: fetch convierte %2e%2e en .. y lo resuelve
// antes de enviar, así que no sirve para probar traversal.
function rawGet(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("servidor", () => {
  // El sitio vive en una subcarpeta; "fuera.txt" está junto a él, fuera de la raíz.
  const parent = mkdtempSync(join(tmpdir(), "veni-serve-"));
  const dir = join(parent, "sitio");
  const body = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
  const big = Buffer.alloc(8 * 1024 * 1024, 7);
  let server: Server;
  let port: number;
  let base: string;

  before(async () => {
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<h1>hola</h1>");
    writeFileSync(join(dir, "roldanillo.pmtiles"), body);
    writeFileSync(join(dir, "grande.pmtiles"), big);
    writeFileSync(join(dir, ".nojekyll"), "");
    writeFileSync(join(dir, "sub", "index.html"), "sub");
    writeFileSync(join(parent, "fuera.txt"), "secreto");
    server = createServer(createHandler(dir));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
    chmodSync(parent, 0o755);
    rmSync(parent, { recursive: true, force: true });
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

  it("un rango sobre un archivo vacío da 416 y el servidor sigue vivo", async () => {
    const res = await fetch(`${base}/.nojekyll`, { headers: { Range: "bytes=-1" } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), "bytes */0");
    assert.equal((await fetch(`${base}/`)).status, 200);
  });

  it("HEAD devuelve las cabeceras sin cuerpo", async () => {
    const res = await fetch(`${base}/roldanillo.pmtiles`, { method: "HEAD", headers: { Range: "bytes=0-15" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-length"), "16");
    assert.equal((await res.arrayBuffer()).byteLength, 0);
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

  it("404 para lo que no existe", async () => {
    assert.equal((await fetch(`${base}/no-existe.json`)).status, 404);
  });

  for (const path of ["/../fuera.txt", "/%2e%2e/fuera.txt", "/sub/../../fuera.txt", "/..%2ffuera.txt", "/..%5cfuera.txt"]) {
    it(`no entrega archivos fuera del sitio: ${path}`, async () => {
      const res = await rawGet(port, path);
      assert.equal(res.status, 404);
      assert.doesNotMatch(res.body, /secreto/);
    });
  }

  it("405 para métodos que no son GET ni HEAD", async () => {
    assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  });

  it("un archivo ilegible no tumba el servidor", { skip: (process.platform === "win32" || process.getuid?.() === 0) && "sin permisos POSIX o como root" }, async () => {
    writeFileSync(join(dir, "privado.json"), "{}");
    chmodSync(join(dir, "privado.json"), 0o000);
    const res = await fetch(`${base}/privado.json`);
    assert.ok(res.status >= 400, `se esperaba un error y llegó ${res.status}`);
    assert.equal((await fetch(`${base}/`)).status, 200);
  });

  it("abortar descargas no deja archivos abiertos", { skip: !existsSync("/proc/self/fd") && "sin /proc" }, async () => {
    const openFds = () => readdirSync("/proc/self/fd").length;
    const before = openFds();
    for (let i = 0; i < 20; i++) {
      const controller = new AbortController();
      const res = await fetch(`${base}/grande.pmtiles`, { signal: controller.signal });
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      await reader.cancel().catch(() => {});
    }
    // Deja que el servidor procese los cierres.
    await new Promise((done) => setTimeout(done, 300));
    assert.ok(openFds() <= before + 2, `descriptores: antes ${before}, después ${openFds()}`);
  });
});
