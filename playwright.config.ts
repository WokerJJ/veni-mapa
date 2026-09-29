// Prueba de render de la demo en Chromium sin interfaz (make render).
//
// Corre en el host, no en la imagen de herramientas: los navegadores de
// Playwright no funcionan en Alpine. Sirve build/site (armado con make all) con
// scripts/serve.ts en la misma URL con la que se generaron los estilos
// (STYLE_BASE_URL por defecto, http://localhost:8080): los estilos piden tiles,
// glyphs y sprites a esa base. Si make serve ya está corriendo, lo reutiliza.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RENDER_PORT ?? 8080);

export default defineConfig({
  testDir: "tests/render",
  outputDir: "test-results",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices["Desktop Chrome"],
    // SwiftShader: WebGL por software, igual en todas las máquinas y en CI.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "node scripts/serve.ts",
    url: `http://localhost:${port}/`,
    env: { SITE_DIR: "build/site", PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
