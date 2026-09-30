// El router en JavaScript para el navegador: la demo lo importa desde vendor/rutas/.
//
//   node --no-warnings scripts/routing/browser.ts <carpeta>
//
// router.ts y graph.ts solo usan sintaxis de tipos que se puede borrar
// (erasableSyntaxOnly): Node la quita sin compilar, igual que al ejecutarlos, y
// aquí solo se cambian las importaciones .ts por .js. Así la demo corre el mismo
// código que prueban `make check` y `make verify`, sin copiarlo a mano.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const FILES = ["graph", "router"] as const;

/** JavaScript de un módulo de scripts/routing, con sus importaciones locales en .js. */
export function toBrowser(source: string, name: string): string {
  // Cualquier especificador "./x.ts" o './x.ts': from, import() e import de efecto.
  const js = stripTypeScriptTypes(source).replace(/(["'])\.\/([a-z-]+)\.ts\1/g, "$1./$2.js$1");
  if (/(["'])[^"'\n]*\.ts\1/.test(js)) throw new Error(`${name}.ts: quedó una importación .ts`);
  return `// Generado desde scripts/routing/${name}.ts por scripts/routing/browser.ts. No editar.\n${js}`;
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error("uso: browser.ts <carpeta>");
  await mkdir(out, { recursive: true });
  for (const name of FILES) {
    const js = toBrowser(await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8"), name);
    await writeFile(join(out, `${name}.js.tmp`), js);
    await rename(join(out, `${name}.js.tmp`), join(out, `${name}.js`));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(`browser.ts: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
