// Prueba de funcionamiento de la posición y las rutas en la demo, en Chromium
// con la geolocalización simulada: lo mismo que hará la app con el mapa.
//
// Usa el sitio armado con datos reales (make all): el grafo de Roldanillo, el
// router generado desde scripts/routing y lugares tomados de OpenStreetMap.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, waitForMap } from "./helpers.ts";

type LngLat = [number, number];

const ALCALDIA: LngLat = [-76.1543668, 4.4111559];
const MUSEO_RAYO: LngLat = [-76.1537, 4.4096];
const VIA_PANORAMA: LngLat = [-76.1452394, 4.3981409];
// Dos nodos de la way 110131603, calle de sentido único hacia el oeste.
const ONEWAY_ESTE: LngLat = [-76.1528384, 4.4128313];
const ONEWAY_OESTE: LngLat = [-76.1543889, 4.4127813];
// En las montañas del oeste, a más de 1 km de cualquier vía.
const MONTANA: LngLat = [-76.29, 4.4];
const BOGOTA: LngLat = [-74.0721, 4.711];

const FOOT_MS = 4.5 / 3.6;

const geo = ([longitude, latitude]: LngLat) => ({ geolocation: { longitude, latitude, accuracy: 10 }, permissions: ["geolocation"] });
const mover = (context: BrowserContext, [longitude, latitude]: LngLat) => context.setGeolocation({ longitude, latitude, accuracy: 10 });

/** Toca "¿Dónde estoy?" y espera a que la demo tenga la posición (o sepa que está fuera). */
async function ubicar(page: Page, nombre = "¿Dónde estoy?"): Promise<void> {
  await page.getByRole("button", { name: nombre }).click();
  await page.waitForFunction(() => window.veniRuta.posicion !== null || window.veniRuta.estado === "fuera");
  await waitForMap(page);
}

/** Centra el mapa en un punto y lo toca, como una persona. */
async function tocar(page: Page, punto: LngLat): Promise<void> {
  // Sin devolver el resultado de jumpTo (el mapa entero).
  await page.evaluate((center) => {
    window.veniMapa.jumpTo({ center });
  }, punto);
  await waitForMap(page);
  const { x, y } = await page.evaluate((p) => window.veniMapa.project(p), punto);
  await page.locator("#mapa canvas").click({ position: { x, y } });
  await page.waitForFunction(() => !["calculando", "listo"].includes(window.veniRuta.estado));
}

/** Coordenadas de la línea dibujada (la fuente "ruta"), o 0 si está vacía. */
const dibujada = (page: Page) =>
  page.evaluate(async () => {
    const data = await window.veniMapa.getSource("ruta")?.getData();
    return data?.type === "Feature" ? (data.geometry?.coordinates.length ?? 0) : 0;
  });

const panel = (page: Page) => page.getByRole("status");
const ultima = (page: Page) => page.evaluate(() => window.veniRuta.ultima);
const estadoRuta = (page: Page) => page.evaluate(() => window.veniRuta.estado);

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

/** Pedidos del grafo de rutas hechos por la página. */
function pedidosDelGrafo(page: Page): string[] {
  const pedidos: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("-rutas.json")) pedidos.push(request.url());
  });
  return pedidos;
}

/** Demora el grafo para probar lo que pasa mientras se baja. */
async function demorarGrafo(page: Page, ms: number): Promise<void> {
  await page.route("**/*-rutas.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

/** Toca un punto sin mover la cámara ni esperar la ruta. */
async function tocarSinEsperar(page: Page, punto: LngLat): Promise<void> {
  const { x, y } = await page.evaluate((p) => window.veniMapa.project(p), punto);
  await page.locator("#mapa canvas").click({ position: { x, y } });
}

test.describe("desde la Alcaldía", () => {
  test.use(geo(ALCALDIA));

  test("¿Dónde estoy? muestra la posición, pide un destino y no la deja en la URL", async ({ page }) => {
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
    // La cámara se centró en la posición, pero la vista compartible no la guarda.
    const url = page.url();
    for (const pista of ["4.4111", "4.4112", "-76.1543", "-76.1544"]) expect(url).not.toContain(pista);
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toContain("76.154");
    expect(errors).toEqual([]);
  });

  test("tocar el Museo Rayo dibuja la ruta a pie; el grafo se baja una sola vez, recién al tocar", async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const pedidos = pedidosDelGrafo(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    expect(pedidos, "el grafo no se baja al abrir").toEqual([]);

    await tocar(page, MUSEO_RAYO);
    const ruta = (await ultima(page))!;
    expect(ruta.distance).toBeGreaterThan(150);
    expect(ruta.distance).toBeLessThan(600);
    // A pie: el largo a 4,5 km/h.
    expect(Math.abs(ruta.duration - ruta.distance / FOOT_MS)).toBeLessThan(1);
    await expect(panel(page)).toContainText(/\d+ m · \d+ min a pie/);
    // La línea dibujada es la del router.
    expect(await dibujada(page)).toBe(ruta.coordinates.length);
    await expect(page.getByRole("img", { name: "Destino de la ruta" })).toBeVisible();
    await capturar(page, testInfo, "demo-ruta-a-pie");

    // Una segunda ruta usa el grafo ya bajado.
    await tocar(page, VIA_PANORAMA);
    expect(await estadoRuta(page)).toBe("ruta");
    expect(pedidos).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("un punto lejos de las calles muestra que no hay ruta y borra la línea", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MUSEO_RAYO);
    expect(await dibujada(page)).toBeGreaterThan(2);
    await tocar(page, MONTANA);
    expect(await estadoRuta(page)).toBe("sin-ruta");
    expect(await ultima(page)).toBeNull();
    await expect(panel(page)).toContainText("ese punto está lejos");
    expect(await dibujada(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("cambiar a oscuro conserva la ruta dibujada", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MUSEO_RAYO);
    const puntos = (await ultima(page))!.coordinates.length;
    await page.getByRole("button", { name: "Oscuro" }).click();
    const oscuro = (JSON.parse(readFileSync("build/site/style/veni-oscuro-es.json", "utf8")) as { name: string }).name;
    await page.waitForFunction((name) => window.veniMapa.getStyle()?.name === name, oscuro);
    await waitForMap(page);
    expect(await dibujada(page)).toBe(puntos);
    await expect(panel(page)).toContainText(/min a pie/);
    expect(errors).toEqual([]);
  });

  test("cambiar de tema mientras se baja el grafo no deja errores y la ruta se dibuja", async ({ page }) => {
    const errors = collectErrors(page);
    await demorarGrafo(page, 1500);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocarSinEsperar(page, MUSEO_RAYO);
    await page.getByRole("button", { name: "Oscuro" }).click();
    await page.waitForFunction(() => window.veniRuta.estado === "ruta", null, { timeout: 20_000 });
    await waitForMap(page);
    expect(await dibujada(page)).toBe((await ultima(page))!.coordinates.length);
    expect(errors).toEqual([]);
  });

  test("si la posición cambia, la ruta se recalcula; si tiembla menos de 10 m, no", async ({ page, context }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MUSEO_RAYO);
    const antes = (await ultima(page))!;
    await page.evaluate(() => {
      (window as unknown as { rutaAntes: unknown }).rutaAntes = window.veniRuta.ultima;
    });
    // ~3 m: la misma ruta (el mismo objeto).
    await mover(context, [ALCALDIA[0] + 0.00003, ALCALDIA[1]]);
    await page.waitForFunction(() => window.veniRuta.posicion?.[0] !== -76.1543668);
    expect(await page.evaluate(() => (window as unknown as { rutaAntes: unknown }).rutaAntes === window.veniRuta.ultima)).toBe(true);
    // A la Vía Panorama: otra ruta.
    await mover(context, VIA_PANORAMA);
    await page.waitForFunction((d) => (window.veniRuta.ultima?.distance ?? d) !== d, antes.distance);
    expect((await ultima(page))!.coordinates[0]).not.toEqual(antes.coordinates[0]);
    expect(errors).toEqual([]);
  });

  test("apagar «¿Dónde estoy?» borra la posición y la ruta", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await page.getByRole("button", { name: "¿Dónde estoy?" }).click();
    await page.waitForFunction(() => window.veniRuta.posicion === null);
    await expect(page.locator(".maplibregl-user-location-dot")).toHaveCount(0);
    expect(await estadoRuta(page)).toBe("sin-posicion");
    await tocarSinEsperar(page, MUSEO_RAYO);
    expect(await estadoRuta(page)).toBe("pedir-posicion");
    expect(await dibujada(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("si la posición sale de la región mientras se baja el grafo, queda «fuera»", async ({ page, context }) => {
    const errors = collectErrors(page);
    await demorarGrafo(page, 1500);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    // Se espera antes de tocar: si la respuesta llegara antes de esperarla, no se vería.
    const grafo = page.waitForResponse("**/*-rutas.json");
    await tocarSinEsperar(page, MUSEO_RAYO);
    await mover(context, BOGOTA);
    await page.waitForFunction(() => window.veniRuta.estado === "fuera");
    // Llega el grafo: el cálculo viejo se descarta.
    await grafo;
    await page.waitForTimeout(300);
    expect(await estadoRuta(page)).toBe("fuera");
    await expect(panel(page)).toContainText("fuera de Roldanillo");
    expect(await dibujada(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("en inglés el panel, el botón de ubicación y el destino están traducidos", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=en");
    await waitForMap(page);
    await ubicar(page, "Where am I?");
    await tocar(page, MUSEO_RAYO);
    await expect(panel(page)).toContainText(/\d+ m · \d+ min walking/);
    await expect(page.getByRole("img", { name: "Route destination" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("sentido único real", () => {
  test.use(geo(ONEWAY_OESTE));

  test("en carro rodea la calle de sentido único; a pie va directo", async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const pedidos = pedidosDelGrafo(page);
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
    // En carro llega antes aunque dé la vuelta.
    expect(enCarro.duration).toBeLessThan(aPie.duration);
    expect(await dibujada(page)).toBe(enCarro.coordinates.length);
    await expect(panel(page)).toContainText(/min en carro/);
    await expect(page.getByRole("button", { name: "En carro" })).toHaveAttribute("aria-pressed", "true");
    expect(pedidos).toHaveLength(1);
    await capturar(page, testInfo, "demo-ruta-en-carro");
    expect(errors).toEqual([]);
  });
});

test.describe("posición lejos de las calles", () => {
  test.use(geo(MONTANA));

  test("el mensaje dice que es la posición la que está lejos, no el destino", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await ubicar(page);
    await tocar(page, MUSEO_RAYO);
    expect(await estadoRuta(page)).toBe("posicion-lejos");
    await expect(panel(page)).toContainText("tu posición está lejos");
    expect(errors).toEqual([]);
  });
});

test.describe("sin posición, sin permiso o fuera de la región", () => {
  test("tocar el mapa sin ubicarse pide tocar ¿Dónde estoy? primero", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await tocarSinEsperar(page, MUSEO_RAYO);
    await expect(panel(page)).toContainText("Primero tocá «¿Dónde estoy?»");
    expect(await estadoRuta(page)).toBe("pedir-posicion");
    expect(errors).toEqual([]);
  });

  test("sin permiso de ubicación lo dice", async ({ page }) => {
    await page.goto("/?tema=claro&idioma=es");
    await waitForMap(page);
    await page.getByRole("button", { name: "¿Dónde estoy?" }).click();
    await page.waitForFunction(() => window.veniRuta.estado === "sin-permiso");
    await expect(panel(page)).toContainText("Sin permiso");
    expect(await page.evaluate(() => window.veniRuta.posicion)).toBeNull();
  });

  test.describe("desde Bogotá", () => {
    test.use(geo(BOGOTA));

    test("avisa que la posición está fuera de Roldanillo y no rutea", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto("/?tema=claro&idioma=es");
      await waitForMap(page);
      await ubicar(page);
      expect(await estadoRuta(page)).toBe("fuera");
      await expect(panel(page)).toContainText("fuera de Roldanillo");
      await tocarSinEsperar(page, MUSEO_RAYO);
      expect(await estadoRuta(page)).toBe("fuera");
      expect(errors).toEqual([]);
    });
  });
});

test("en móvil el panel de rutas no genera scroll y los botones miden al menos 44 px", async ({ page }) => {
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
  const caja = (await page.getByRole("button", { name: "¿Dónde estoy?" }).boundingBox())!;
  expect(caja.height).toBeGreaterThanOrEqual(44);
  expect(caja.width).toBeGreaterThanOrEqual(44);
});
