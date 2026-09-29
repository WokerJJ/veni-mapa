// Render de la demo en Chromium sin interfaz: el mapa se dibuja de verdad,
// sin errores, en los cuatro estilos y sin tener que mover la cámara.
import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    veniMapa: {
      loaded(): boolean;
      areTilesLoaded(): boolean;
      isMoving(): boolean;
      getZoom(): number;
      getCenter(): { lng: number; lat: number };
      getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
      getStyle(): { name?: string; metadata?: Record<string, unknown> };
      getPaintProperty(layer: string, property: string): unknown;
      queryRenderedFeatures(): unknown[];
      zoomTo(zoom: number, options: { duration: number }): void;
      getCanvas(): HTMLCanvasElement;
    };
  }
}

const LABELS = {
  es: { zoomIn: "Acercar", map: "Mapa de Roldanillo", title: "Vení · Mapa de Roldanillo" },
  en: { zoomIn: "Zoom in", map: "Map of Roldanillo", title: "Vení · Roldanillo map" },
} as const;

const BACKGROUND = { claro: "#F3ECF6", oscuro: "#1C0F26" } as const;

/** Espera a que el mapa termine de cargar y dibujar sin tocar la cámara. */
async function waitForMap(page: Page): Promise<void> {
  await page.waitForFunction(() => window.veniMapa?.loaded() && window.veniMapa.areTilesLoaded() && !window.veniMapa.isMoving(), null, {
    timeout: 30_000,
  });
}

/** Errores de la página y de consola (los avisos de WebGL no cuentan). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

for (const tema of ["claro", "oscuro"] as const) {
  for (const idioma of ["es", "en"] as const) {
    test(`${tema} · ${idioma}: se dibuja al abrir, sin errores y en su idioma`, async ({ page }, testInfo) => {
      const errors = collectErrors(page);
      await page.goto(`/?tema=${tema}&idioma=${idioma}`);
      await waitForMap(page);

      // Se dibujó sin mover la cámara: hay features en pantalla y la vista es la inicial.
      const state = await page.evaluate(() => ({
        features: window.veniMapa.queryRenderedFeatures().length,
        zoom: window.veniMapa.getZoom(),
        style: window.veniMapa.getStyle().name,
        lang: window.veniMapa.getStyle().metadata?.["veni:lang"],
        background: window.veniMapa.getPaintProperty("background", "background-color"),
      }));
      expect(state.features, "features dibujadas").toBeGreaterThan(50);
      expect(state.zoom).toBeCloseTo(13.5, 1);
      expect(state.lang).toBe(idioma);
      expect(String(state.background).toUpperCase()).toBe(BACKGROUND[tema]);

      // Un lienzo vacío (solo fondo) comprime a muy poco; uno con calles y
      // etiquetas pesa bastante más.
      const shot = await page.locator("#mapa").screenshot();
      await testInfo.attach(`demo-${tema}-${idioma}.png`, { body: shot, contentType: "image/png" });
      expect(shot.byteLength, "captura con contenido").toBeGreaterThan(40_000);

      // Textos accesibles en el idioma elegido.
      await expect(page).toHaveTitle(LABELS[idioma].title);
      await expect(page.locator("html")).toHaveAttribute("lang", idioma);
      await expect(page.locator(".maplibregl-ctrl-zoom-in")).toHaveAttribute("aria-label", LABELS[idioma].zoomIn);
      await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("aria-label", LABELS[idioma].map);
      await expect(page.getByRole("link", { name: /OpenStreetMap/ })).toBeVisible();

      expect(errors).toEqual([]);
    });
  }
}

// Sin center y zoom iniciales el mapa arranca en 0,0 z0 y salta después al
// centro del estilo; en algunos navegadores los tiles no se redibujan hasta
// mover la cámara y el mapa se ve vacío. Chromium sin interfaz sí redibuja, así
// que se comprueba el síntoma determinista: la primera vista que el mapa
// escribe en la URL (#vista=zoom/lat/lon) ya tiene que ser la de la región.
test("el mapa arranca en la región, no en el mundo entero", async ({ page }) => {
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
  expect(views[0]).toMatch(/^#vista=13\.5\/4\.41\d*\/-76\.15\d*$/);
});

test("cambiar a oscuro redibuja el mapa sin mover la cámara", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  const before = await page.evaluate(() => ({ zoom: window.veniMapa.getZoom(), center: window.veniMapa.getCenter() }));

  await page.getByRole("button", { name: "Oscuro" }).click();
  await page.waitForFunction(() => window.veniMapa.getStyle().name === "Vení · Oscuro (ES)");
  await waitForMap(page);

  const after = await page.evaluate(() => ({
    zoom: window.veniMapa.getZoom(),
    center: window.veniMapa.getCenter(),
    background: window.veniMapa.getPaintProperty("background", "background-color"),
    features: window.veniMapa.queryRenderedFeatures().length,
  }));
  expect(String(after.background).toUpperCase()).toBe(BACKGROUND.oscuro);
  expect(after.features).toBeGreaterThan(50);
  expect(after.zoom).toBeCloseTo(before.zoom, 5);
  expect(after.center.lng).toBeCloseTo(before.center.lng, 6);
  await expect(page.getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/tema=oscuro/);
  expect(errors).toEqual([]);
});

test("la cámara no sale de la región al alejarse", async ({ page }) => {
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  await page.evaluate(() => window.veniMapa.zoomTo(2, { duration: 0 }));
  const view = await page.evaluate(() => {
    const b = window.veniMapa.getBounds();
    return { zoom: window.veniMapa.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
  });
  expect(view.zoom).toBeGreaterThan(8);
  const [west, south, east, north] = view.bounds as [number, number, number, number];
  expect(west).toBeGreaterThanOrEqual(-76.3 - 1e-6);
  expect(south).toBeGreaterThanOrEqual(4.3 - 1e-6);
  expect(east).toBeLessThanOrEqual(-76.0 + 1e-6);
  expect(north).toBeLessThanOrEqual(4.55 + 1e-6);
});

test("en móvil no hay scroll horizontal y los botones miden al menos 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/?tema=claro&idioma=es");
  await waitForMap(page);
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll(".grupo button")].map((b) => b.getBoundingClientRect()),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(375);
  for (const button of layout.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.width).toBeGreaterThanOrEqual(44);
  }
});
