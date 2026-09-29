// Prueba de render de la demo en Chromium sin interfaz (npm run test:render).
//
// Corre en el host, no en la imagen de herramientas: los navegadores de
// Playwright no funcionan en Alpine. Sirve build/site (armado con make all) con
// scripts/serve.ts en la misma URL con la que se generaron los estilos: los
// estilos piden tiles, glyphs y sprites a esa base, así que el puerto sale de
// ahí (por defecto, http://localhost:8080). Si ya hay un servidor en ese
// puerto (por ejemplo, make serve) se reutiliza fuera de CI.
import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

function siteBaseUrl(): URL {
  const file = "build/site/style/veni-claro-es.json";
  let base: unknown;
  try {
    base = (JSON.parse(readFileSync(file, "utf8")) as { metadata?: Record<string, unknown> }).metadata?.["veni:base_url"];
  } catch {
    throw new Error(`falta ${file}: corré docker compose run --rm tools make all`);
  }
  const url = new URL(String(base));
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`los estilos apuntan a ${url.href}; para el render generalos para localhost: make style site STYLE_BASE_URL=http://localhost:8080`);
  }
  return url;
}

const base = siteBaseUrl();
const port = base.port || "80";

export default defineConfig({
  testDir: "tests/render",
  outputDir: "test-results",
  timeout: 60_000,
  // Un reintento en CI ayuda a leer el fallo, pero una prueba que pasa solo
  // al reintentar cuenta como fallo: justamente lo intermitente es lo que se busca.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: base.origin,
    ...devices["Desktop Chrome"],
    // SwiftShader: WebGL por software, igual en todas las máquinas y en CI.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.ts",
    url: `${base.origin}/`,
    env: { SITE_DIR: "build/site", PORT: port },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
