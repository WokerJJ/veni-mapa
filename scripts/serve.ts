// `make serve`: sirve BUILD_DIR/site en http://localhost:8080.
//
// Servidor estático mínimo con lo que PMTiles necesita: peticiones por rango
// (206 Partial Content), HEAD y CORS abierto, igual que GitHub Pages.
import { createReadStream, statSync, type Stats } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".pbf": "application/x-protobuf",
  ".pmtiles": "application/octet-stream",
  ".ttf": "font/ttf",
};

export type ByteRange = { start: number; end: number };

/**
 * Interpreta la cabecera Range para un archivo de `size` bytes.
 * - null: no hay rango usable (se responde el archivo completo).
 * - "invalido": rango fuera del archivo (416).
 * Solo se atiende un rango; varios rangos se responden completos (lo permite la RFC 9110).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | "invalido" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;
  if (first === "") {
    // bytes=-N: los últimos N bytes.
    const length = Number(last);
    if (length === 0) return "invalido";
    return { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || start > end) return "invalido";
  return { start, end };
}

/** Ruta del archivo para una URL, o null si sale de `root`. */
export function resolvePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const path = resolve(join(base, decoded));
  if (path !== base && !path.startsWith(base + sep)) return null;
  return path;
}

export function createHandler(root: string) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, ETag");
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }

    let path = resolvePath(root, req.url ?? "/");
    let stats: Stats | undefined;
    try {
      if (path) stats = statSync(path);
      if (path && stats?.isDirectory()) {
        path = join(path, "index.html");
        stats = statSync(path);
      }
    } catch {
      stats = undefined;
    }
    if (!path || !stats?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado\n");
      return;
    }

    const size = stats.size;
    const headers = {
      "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
      ETag: `"${size}-${stats.mtimeMs}"`,
    };
    const range = parseRange(req.headers.range, size);
    if (range === "invalido") {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` }).end();
      return;
    }
    if (range) {
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${size}`, "Content-Length": range.end - range.start + 1 });
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
    }
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(path, range ?? undefined).pipe(res);
  };
}

// Solo al ejecutarse como programa, no al importarse desde las pruebas.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.env.SITE_DIR ?? "build/site";
  const port = Number(process.env.PORT ?? 8080);
  try {
    statSync(join(root, "index.html"));
  } catch {
    console.error(`serve.ts: falta ${root}/index.html (corré make site)`);
    process.exit(1);
  }
  // 0.0.0.0: dentro del contenedor, para que llegue el puerto publicado por Docker.
  createServer(createHandler(root)).listen(port, "0.0.0.0", () => {
    console.log(`==> Sirviendo ${root} en http://localhost:${port} (Ctrl+C para salir)`);
  });
}
