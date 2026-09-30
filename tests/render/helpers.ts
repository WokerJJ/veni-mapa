// Ayudantes de las pruebas de render: tipos del mapa que la demo expone en
// window, espera a que el mapa quede en reposo y errores de la página.
import type { Page } from "@playwright/test";

export interface Style {
  name?: string;
  center?: [number, number];
  zoom?: number;
  metadata?: Record<string, unknown>;
  layers?: { id: string; paint?: Record<string, unknown> }[];
}

declare global {
  interface Window {
    veniMapa: {
      loaded(): boolean;
      areTilesLoaded(): boolean;
      isMoving(): boolean;
      once(event: string, listener: () => void): void;
      triggerRepaint(): void;
      getZoom(): number;
      getCenter(): { lng: number; lat: number };
      getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
      getStyle(): Style | undefined;
      getPaintProperty(layer: string, property: string): unknown;
      queryRenderedFeatures(): unknown[];
      zoomTo(zoom: number, options: { duration: number }): void;
      jumpTo(options: { center: [number, number]; zoom?: number }): void;
      project(lngLat: [number, number]): { x: number; y: number };
      getLayer(id: string): unknown;
    };
    /** Estado de la ruta en la demo (posición, perfil y última ruta calculada). */
    veniRuta: {
      posicion: [number, number] | null;
      perfil: "foot" | "car";
      estado: "sin-posicion" | "pedir-posicion" | "listo" | "calculando" | "ruta" | "sin-ruta" | "fuera" | "error" | "sin-permiso";
      ultima: {
        distance: number;
        duration: number;
        coordinates: [number, number][];
        snap: { from: number; to: number };
      } | null;
    };
  }
}

/** Espera a que el mapa cargue y quede en reposo (evento idle), sin mover la cámara. */
export async function waitForMap(page: Page): Promise<void> {
  await page.waitForFunction(() => window.veniMapa?.getStyle() !== undefined && window.veniMapa.loaded(), null, { timeout: 30_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = window.veniMapa;
        map.once("idle", () => resolve());
        // Si ya estaba en reposo, un repintado vuelve a emitir idle.
        if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) map.triggerRepaint();
      }),
  );
}

/** Errores de la página, de consola y respuestas ≥ 400 (los avisos de WebGL no cuentan). */
export function collectErrors(page: Page): string[] {
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

