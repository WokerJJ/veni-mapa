// Render de la demo en Chromium sin interfaz: el mapa se dibuja de verdad,
// sin errores, en los cuatro estilos y sin tener que mover la cámara.
//
// Lo esperado (vista inicial, caja, fondo) se lee de los estilos servidos, que
// salen de config/region.yml y de la paleta: aquí no se repiten valores.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { collectErrors, waitForMap, type Style } from "./helpers.ts";

type Tema = "claro" | "oscuro";
type Idioma = "es" | "en";

const served = (tema: Tema, idioma: Idioma): Style =>
  JSON.parse(readFileSync(`build/site/style/veni-${tema}-${idioma}.json`, "utf8")) as Style;
const background = (style: Style): string =>
  String(style.layers?.find((layer) => layer.id === "background")?.paint?.["background-color"]).toUpperCase();

const LABELS = {
  es: { zoomIn: "Acercar", map: "Mapa de Roldanillo", title: "Vení · Mapa de Roldanillo", oscuro: "Oscuro" },
  en: { zoomIn: "Zoom in", map: "Map of Roldanillo", title: "Vení · Roldanillo map", oscuro: "Dark" },
} as const;

// Con RENDER_CAPTURE_DIR, las capturas también se guardan ahí (las del README
// salen de docs/img: ver "Pruebas" en el README).
const captureDir = process.env.RENDER_CAPTURE_DIR;

/** El lienzo tiene contenido: un mapa vacío (solo fondo) comprime a < 10 KB; uno real, a > 200 KB. */
async function expectDrawn(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const shot = await page.locator("#mapa").screenshot();
  await testInfo.attach(`${name}.png`, { body: shot, contentType: "image/png" });
  expect(shot.byteLength, `captura de ${name} con contenido`).toBeGreaterThan(40_000);
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    writeFileSync(join(captureDir, `${name}.png`), shot);
  }
}

for (const tema of ["claro", "oscuro"] as const) {
  for (const idioma of ["es", "en"] as const) {
    test(`${tema} · ${idioma}: se dibuja al abrir, sin errores y en su idioma`, async ({ page }, testInfo) => {
      const style = served(tema, idioma);
      const errors = collectErrors(page);
      await page.goto(`/?tema=${tema}&idioma=${idioma}`);
      await waitForMap(page);
      // Primero los errores: explican mejor un mapa vacío (por ejemplo, un 404).
      expect(errors).toEqual([]);

      // Los estilos piden los datos al mismo origen que sirve la página.
      expect(String(style.metadata?.["veni:base_url"])).toBe(new URL(page.url()).origin);

      const state = await page.evaluate(() => ({
        features: window.veniMapa.queryRenderedFeatures().length,
        zoom: window.veniMapa.getZoom(),
        name: window.veniMapa.getStyle()?.name,
        background: window.veniMapa.getPaintProperty("background", "background-color"),
      }));
      expect(state.name).toBe(style.name);
      expect(state.zoom).toBeCloseTo(Number(style.zoom), 3);
      expect(String(state.background).toUpperCase()).toBe(background(style));
      expect(state.features, "features en los tiles cargados").toBeGreaterThan(50);
      await expectDrawn(page, testInfo, `demo-${tema}-${idioma}`);

      // Textos accesibles en el idioma elegido.
      await expect(page).toHaveTitle(LABELS[idioma].title);
      await expect(page.locator("html")).toHaveAttribute("lang", idioma);
      await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveAttribute("aria-label", LABELS[idioma].zoomIn);
      await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("aria-label", LABELS[idioma].map);
      await expect(page.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();
    });
  }
}

// Sin center y zoom iniciales el mapa arranca en 0,0 z0 y salta después al
// centro del estilo; en algunos navegadores los tiles no se redibujan hasta
// mover la cámara y el mapa se ve vacío. Chromium sin interfaz sí redibuja, así
// que se comprueba el síntoma determinista: la primera vista que el mapa
// escribe en la URL (#vista=zoom/lat/lon) ya tiene que ser la del estilo.
test("el mapa arranca en la región, no en el mundo entero", async ({ page }) => {
  const style = served("claro", "es");
  await page.addInitScript(() => {
    const views: string[] = [];
    (window as unknown as { vistas: string[] }).vistas = views;
    const replace = history.replaceState.bind(history);
    history.replaceState = (data, unused, url) => {
      const hash = url ? new URL(String(url), location.href).hash : "";
      if (hash.startsWith("#vista=")) views.push(hash);
      replace(data, unused, url);
    };
  });
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  const views = await page.evaluate(() => (window as unknown as { vistas: string[] }).vistas);
  expect(views.length, "el mapa escribió su vista en la URL").toBeGreaterThan(0);
  const [zoom, lat, lon] = views[0]!.replace("#vista=", "").split("/").map(Number) as [number, number, number];
  const [centerLon, centerLat] = style.center!;
  expect(zoom, `primera vista ${views[0]}`).toBeCloseTo(Number(style.zoom), 3);
  expect(lat).toBeCloseTo(centerLat, 3);
  expect(lon).toBeCloseTo(centerLon, 3);
});

test("cambiar a oscuro redibuja el mapa sin mover la cámara", async ({ page }, testInfo) => {
  const oscuro = served("oscuro", "es");
  const errors = collectErrors(page);
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  const before = await page.evaluate(() => ({ zoom: window.veniMapa.getZoom(), center: window.veniMapa.getCenter() }));

  await page.getByRole("button", { name: LABELS.es.oscuro }).click();
  // Mientras se recarga el estilo completo, getStyle() puede devolver undefined.
  await page.waitForFunction((name) => window.veniMapa.getStyle()?.name === name, oscuro.name);
  await waitForMap(page);
  expect(errors).toEqual([]);

  const after = await page.evaluate(() => ({
    zoom: window.veniMapa.getZoom(),
    center: window.veniMapa.getCenter(),
    background: window.veniMapa.getPaintProperty("background", "background-color"),
  }));
  expect(String(after.background).toUpperCase()).toBe(background(oscuro));
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.center.lng).toBeCloseTo(before.center.lng, 6);
  expect(after.center.lat).toBeCloseTo(before.center.lat, 6);
  // Se redibujó de verdad, no solo cambió el fondo.
  await expectDrawn(page, testInfo, "demo-cambio-a-oscuro");
  await expect(page.getByRole("button", { name: LABELS.es.oscuro })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/tema=oscuro/);
});

test("la cámara no sale de la región al alejarse", async ({ page }) => {
  const [west, south, east, north] = served("claro", "es").metadata?.["veni:bounds"] as [number, number, number, number];
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  await page.evaluate(() => window.veniMapa.zoomTo(2, { duration: 0 }));
  const view = await page.evaluate(() => {
    const b = window.veniMapa.getBounds();
    return { zoom: window.veniMapa.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
  });
  expect(view.zoom).toBeGreaterThan(2);
  const [viewWest, viewSouth, viewEast, viewNorth] = view.bounds as [number, number, number, number];
  expect(viewWest).toBeGreaterThanOrEqual(west - 1e-6);
  expect(viewSouth).toBeGreaterThanOrEqual(south - 1e-6);
  expect(viewEast).toBeLessThanOrEqual(east + 1e-6);
  expect(viewNorth).toBeLessThanOrEqual(north + 1e-6);
});

test("en móvil no hay scroll horizontal y los botones de tema e idioma miden al menos 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const buttons = page.getByRole("toolbar").getByRole("button");
  await expect(buttons).toHaveCount(4);
  for (const box of await buttons.evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});
