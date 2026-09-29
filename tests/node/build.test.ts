// Pruebas de scripts/style/build.ts de punta a punta: lo ejecuta como `make
// style` (proceso aparte con variables de entorno) en una carpeta temporal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "veni-style-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const validEnv = {
  BUILD_DIR: dir,
  REGION_NAME: "roldanillo",
  REGION_BBOX: "-76.30,4.30,-76.00,4.55",
  REGION_CENTER: "-76.1547,4.4128",
  REGION_ZOOM: "13.5",
  STYLE_BASE_URL: "https://tiles.example.com/v9/",
  STYLE_VERSION: "9.9.9",
};

function run(overrides: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...validEnv, ...overrides };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return spawnSync(process.execPath, ["scripts/style/build.ts"], { env, encoding: "utf8" });
}

const styleFile = (name: string) => join(dir, "style", name);
const leftovers = () => readdirSync(dir).filter((name) => name.startsWith(".style.") || name === "style.old");

describe("build.ts", () => {
  it("genera los cuatro estilos con la base, el centro y la versión del entorno", () => {
    writeFileSync(join(dir, "build.json"), JSON.stringify({ protomaps_build: "20260928" }));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(dir, "style")).sort(), [
      "veni-claro-en.json",
      "veni-claro-es.json",
      "veni-oscuro-en.json",
      "veni-oscuro-es.json",
    ]);
    const style = JSON.parse(readFileSync(styleFile("veni-claro-es.json"), "utf8"));
    assert.equal(style.glyphs, "https://tiles.example.com/v9/fonts/{fontstack}/{range}.pbf");
    assert.deepEqual(style.center, [-76.1547, 4.4128]);
    assert.deepEqual(style.metadata["veni:bounds"], [-76.3, 4.3, -76, 4.55]);
    assert.equal(style.metadata["veni:version"], "9.9.9");
    assert.equal(style.metadata["veni:protomaps_build"], "20260928");
    assert.match(result.stdout, /base https:\/\/tiles\.example\.com\/v9,/);
    assert.deepEqual(leftovers(), []);
  });

  it("la carpeta publicada es legible por otros usuarios", { skip: process.platform === "win32" && "sin permisos POSIX" }, () => {
    assert.equal(statSync(join(dir, "style")).mode & 0o777, 0o755);
  });

  for (const [name, overrides, message] of [
    ["centro inválido", { REGION_CENTER: "4.41,-176.15" }, /REGION_CENTER/],
    ["caja inválida", { REGION_BBOX: "-76.00,4.30,-76.30,4.55" }, /REGION_BBOX/],
    ["zoom inválido", { REGION_ZOOM: "0x10" }, /REGION_ZOOM/],
    ["región inválida", { REGION_NAME: "a b?x" }, /REGION_NAME/],
    ["URL con credenciales", { STYLE_BASE_URL: "https://u:p@tiles.example.com" }, /usuario ni contraseña/],
    ["sin URL base", { STYLE_BASE_URL: undefined }, /falta STYLE_BASE_URL/],
    ["sin versión", { STYLE_VERSION: undefined }, /falta STYLE_VERSION/],
  ] as const) {
    it(`${name}: falla sin tocar la salida anterior ni dejar temporales`, () => {
      const before = readFileSync(styleFile("veni-claro-es.json"), "utf8");
      const result = run(overrides);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
      assert.equal(readFileSync(styleFile("veni-claro-es.json"), "utf8"), before);
      assert.deepEqual(leftovers(), []);
    });
  }

  it("una URL con credenciales no aparece en ningún mensaje", () => {
    const result = run({ STYLE_BASE_URL: "https://deploy:s3cr3t@tiles.example.com" });
    assert.doesNotMatch(result.stdout + result.stderr, /s3cr3t/);
  });

  it("sin build.json la build de Protomaps queda como desconocida", () => {
    rmSync(join(dir, "build.json"));
    assert.equal(run().status, 0);
    const style = JSON.parse(readFileSync(styleFile("veni-oscuro-en.json"), "utf8"));
    assert.equal(style.metadata["veni:protomaps_build"], "desconocida");
    assert.ok(existsSync(styleFile("veni-claro-es.json")));
  });
});
