// Prueba de funcionamiento de la posición y las rutas en la demo, en Chromium
// con la geolocalización simulada: lo mismo que hará la app con el mapa.
//
// Usa el sitio armado con datos reales (make all): el grafo de Roldanillo, el
// router generado desde scripts/routing y lugares tomados de OpenStreetMap.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, waitForMap } from "./helpers.ts";

type LngLat = [number, number];

const ALCALDIA: LngLat = [-76.1543668, 4.4111559];
const MUSEO_RAYO: LngLat = [-76.1537, 4.4096];
// Dos nodos de la way 110131603, calle de sentido único hacia el oeste.
const ONEWAY_ESTE: LngLat = [-76.1528384, 4.4128313];
const ONEWAY_OESTE: LngLat = [-76.1543889, 4.4127813];
// En las montañas del oeste, a más de 1 km de cualquier vía.
const MONTANA: LngLat = [-76.29, 4.4];
const BOGOTA: LngLat = [-74.0721, 4.711];

const geo = ([longitude, latitude]: LngLat) => ({ geolocation: { longitude, latitude, accuracy: 10 }, permissions: ["geolocation"] });

/** Toca "¿Dónde estoy?" y espera a que la demo tenga la posición. */
async function ubicar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "¿Dónde estoy?" }).click();
  await page.waitForFunction(() => window.veniRuta.posicion !== null || window.veniRuta.estado === "fuera");
  await waitForMap(page);
}

/** Centra el mapa en un punto y lo toca, como una persona. */
async function tocar(page: Page, punto: LngLat): Promise<void> {
  await page.evaluate((center) => window.veniMapa.jumpTo({ center }), punto);
  await waitForMap(page);
  const { x, y } = await page.evaluate((p) => window.veniMapa.project(p), punto);
  await page.locator("#mapa canvas").click({ position: { x, y } });
  await page.waitForFunction(() => window.veniRuta.estado !== "calculando" && window.veniRuta.estado !== "listo");
}

const panel = (page: Page) => page.getByRole("status");

/** Captura de la página (mapa y panel) como adjunto y, con RENDER_CAPTURE_DIR, en esa carpeta. */
async function capturar(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await waitForMap(page);
  const shot = await page.screenshot();
  await testInfo.attach(`${name}.png`, { body: shot, contentType: "image/png" });
  const dir = process.env.RENDER_CAPTURE_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.png`), shot);
  }
}
const ultima = (page: Page) => page.evaluate(() => window.veniRuta.ultima);

test.describe("desde la Alcaldía", () => {
  test.use(geo(ALCALDIA));

  test("¿Dónde estoy? muestra la posición y pide tocar un destino", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await expect(panel(page)).toContainText("Tocá «¿Dónde estoy?»");
    await ubicar(page);
    await expect(page.locator(".maplibregl-user-location-dot")).toBeVisible();
    const [lon, lat] = (await page.evaluate(() => window.veniRuta.posicion))!;
    expect(lon).toBeCloseTo(ALCALDIA[0], 5);
    expect(lat).toBeCloseTo(ALCALDIA[1], 5);
    await expect(panel(page)).toContainText("Tocá un punto del mapa");
    expect(errors).toEqual([]);
  });

  test("tocar el Museo Rayo dibuja la ruta a pie, con distancia y tiempo; el grafo se baja recién ahí", async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const pedidos: string[] = [];
    page.on("request", (request) => pedidos.push(request.url()));
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    expect(pedidos.filter((url) => url.includes("-rutas.json")), "el grafo no se baja al abrir").toEqual([]);

    await tocar(page, MUSEO_RAYO);
    expect(pedidos.filter((url) => url.includes("-rutas.json"))).toHaveLength(1);
    const ruta = (await ultima(page))!;
    expect(ruta.distance).toBeGreaterThan(150);
    expect(ruta.distance).toBeLessThan(600);
    await expect(panel(page)).toContainText(/\d+ m · \d+ min a pie/);
    // La línea está en el mapa, con el camino del router.
    expect(await page.evaluate(() => window.veniMapa.getLayer("ruta") !== undefined)).toBe(true);
    expect(ruta.coordinates.length).toBeGreaterThan(2);
    await capturar(page, testInfo, "demo-ruta-a-pie");
    expect(errors).toEqual([]);
  });

  test("un punto lejos de las calles muestra que no hay ruta", async ({ page }) => {
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MONTANA);
    expect(await page.evaluate(() => window.veniRuta.estado)).toBe("sin-ruta");
    expect(await ultima(page)).toBeNull();
    await expect(panel(page)).toContainText("Sin ruta");
    expect(await page.evaluate(() => window.veniMapa.getLayer("ruta") === undefined || window.veniRuta.ultima === null)).toBe(true);
  });

  test("cambiar a oscuro conserva la ruta dibujada", async ({ page }) => {
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MUSEO_RAYO);
    await page.getByRole("button", { name: "Oscuro" }).click();
    const oscuro = (JSON.parse(readFileSync("build/site/style/veni-oscuro-es.json", "utf8")) as { name: string }).name;
    await page.waitForFunction((name) => window.veniMapa.getStyle()?.name === name, oscuro);
    await waitForMap(page);
    expect(await page.evaluate(() => window.veniMapa.getLayer("ruta") !== undefined)).toBe(true);
    await expect(panel(page)).toContainText(/min a pie/);
  });

  test("en inglés el panel y el botón de ubicación están traducidos", async ({ page }) => {
    await page.goto("/?tema=claro&idioma=en");
    await waitForMap(page);
    await page.getByRole("button", { name: "Where am I?" }).click();
    await page.waitForFunction(() => window.veniRuta.posicion !== null);
    await tocar(page, MUSEO_RAYO);
    await expect(panel(page)).toContainText(/\d+ m · \d+ min walking/);
  });
});

test.describe("sentido único real", () => {
  test.use(geo(ONEWAY_OESTE));

  test("en carro rodea la calle de sentido único; a pie va directo", async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, ONEWAY_ESTE);
    const aPie = (await ultima(page))!;
    await page.getByRole("button", { name: "En carro" }).click();
    await page.waitForFunction(() => window.veniRuta.perfil === "car" && window.veniRuta.estado === "ruta");
    const enCarro = (await ultima(page))!;
    expect(aPie.distance).toBeLessThan(200);
    expect(enCarro.distance, `en carro ${enCarro.distance} m, a pie ${aPie.distance} m`).toBeGreaterThan(aPie.distance * 2);
    await expect(panel(page)).toContainText(/min en carro/);
    await expect(page.getByRole("button", { name: "En carro" })).toHaveAttribute("aria-pressed", "true");
    await capturar(page, testInfo, "demo-ruta-en-carro");
    expect(errors).toEqual([]);
  });
});

test.describe("sin posición o fuera de la región", () => {
  test("tocar el mapa sin ubicarse pide tocar ¿Dónde estoy? primero", async ({ page }) => {
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    const { x, y } = await page.evaluate((p) => window.veniMapa.project(p), MUSEO_RAYO);
    await page.locator("#mapa canvas").click({ position: { x, y } });
    await expect(panel(page)).toContainText("Primero tocá «¿Dónde estoy?»");
    expect(await page.evaluate(() => window.veniRuta.estado)).toBe("pedir-posicion");
  });

  test.describe("desde Bogotá", () => {
    test.use(geo(BOGOTA));

    test("avisa que la posición está fuera de Roldanillo", async ({ page }) => {
      await page.goto("/?tema=claro&idioma=es");
      await waitForMap(page);
      await ubicar(page);
      expect(await page.evaluate(() => window.veniRuta.estado)).toBe("fuera");
      await expect(panel(page)).toContainText("fuera de Roldanillo");
    });
  });
});

test("en móvil el panel de rutas no genera scroll y sus botones miden al menos 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const botones = page.getByRole("group", { name: "Cómo ir" }).getByRole("button");
  await expect(botones).toHaveCount(2);
  for (const box of await botones.evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  const ubicar = page.getByRole("button", { name: "¿Dónde estoy?" });
  const caja = (await ubicar.boundingBox())!;
  expect(caja.height).toBeGreaterThanOrEqual(44);
  expect(caja.width).toBeGreaterThanOrEqual(44);
});
