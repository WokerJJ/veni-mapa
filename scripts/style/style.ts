// Construye un estilo MapLibre de Vení a partir de @protomaps/basemaps.
// Funciones puras: no leen ni escriben archivos (eso lo hace build.ts).
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { layers } from "@protomaps/basemaps";
import { FLAVORS, FONTS, type Variant } from "./flavors.ts";

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const VARIANTS = Object.keys(FLAVORS) as Variant[];

// Nombre del source dentro del estilo: las capas de basemaps lo referencian.
const SOURCE = "protomaps";

// Capas de lugares que llevan la tipografía de títulos de la marca: municipio,
// barrios y veredas, departamentos y países.
export const PLACE_LAYERS = ["places_locality", "places_subplace", "places_region", "places_country"] as const;

// Fuente que MapLibre usa cuando una capa symbol no define text-font. No se
// publica: si aparece en un estilo, las etiquetas darían 404.
export const MAPLIBRE_DEFAULT_FONTS = ["Open Sans Regular", "Arial Unicode MS Regular"] as const;

// Ícono de respaldo del sprite v4 para tipos de POI sin ícono propio (por
// ejemplo, townhall): sin él, MapLibre avisa de imágenes que faltan.
const FALLBACK_ICON = "townspot";

const ATTRIBUTION: Record<Lang, string> = {
  es: '<a href="https://www.openstreetmap.org/copyright">© colaboradores de OpenStreetMap</a>',
  en: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
};

const TITLE: Record<Variant, Record<Lang, string>> = {
  claro: { es: "Vení · Claro", en: "Vení · Light" },
  oscuro: { es: "Vení · Oscuro", en: "Vení · Dark" },
};

// Sprites de protomaps/basemaps-assets que corresponden a cada variante.
const SPRITE: Record<Variant, string> = { claro: "light", oscuro: "dark" };

export interface StyleOptions {
  variant: Variant;
  lang: Lang;
  /** URL absoluta donde se publican el PMTiles, los glyphs y los sprites. */
  baseUrl: string;
  /** Nombre del extracto: <baseUrl>/<region>.pmtiles */
  region: string;
  center: [number, number];
  /** Caja de la región [oeste, sur, este, norte]: los visores limitan la cámara a ella. */
  bounds: [number, number, number, number];
  zoom: number;
  /** Versión del estilo (la fija la release; "dev" en local). */
  version: string;
  /** Fecha de la build de Protomaps del extracto (build/build.json). */
  protomapsBuild: string;
}

// basemaps nombra fuentes de Noto que no se publican (por ejemplo, la de
// Devanagari para etiquetas en hindi). Todo lo que no sea de la marca pasa a
// Figtree Regular, que ya trae el respaldo de Noto dentro.
const NOTO_TO_BRAND: Record<string, string> = {
  "Noto Sans Regular": FONTS.regular,
  "Noto Sans Medium": FONTS.bold,
  "Noto Sans Italic": FONTS.italic,
};

function replaceFonts(value: unknown): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("Noto Sans")) return value;
    return NOTO_TO_BRAND[value] ?? FONTS.regular;
  }
  if (Array.isArray(value)) return value.map(replaceFonts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, replaceFonts(inner)]));
  }
  return value;
}

const PLACE_LAYER_IDS = new Set<string>(PLACE_LAYERS);

function brandLayer(layer: LayerSpecification): LayerSpecification {
  if (!("layout" in layer) || !layer.layout) return layer;
  const layout = replaceFonts(layer.layout) as Record<string, unknown>;
  if (PLACE_LAYER_IDS.has(layer.id) && "text-font" in layout) {
    layout["text-font"] = [FONTS.places];
  }
  if (layer.id === "pois" && layout["icon-image"] !== undefined) {
    layout["icon-image"] = ["coalesce", ["image", layout["icon-image"]], ["image", FALLBACK_ICON]];
  }
  return { ...layer, layout } as LayerSpecification;
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`STYLE_BASE_URL debe ser una URL absoluta (recibido: '${raw}')`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`STYLE_BASE_URL debe usar http o https (recibido: '${raw}')`);
  }
  // Los navegadores no piden URLs con credenciales, y quedarían publicadas en el estilo.
  if (url.username || url.password) {
    throw new Error("STYLE_BASE_URL no puede llevar usuario ni contraseña");
  }
  // href, no search/hash: un "?" o "#" vacío también convertiría la ruta en query.
  if (/[?#]/.test(url.href)) {
    throw new Error(`STYLE_BASE_URL no puede tener query ni fragmento (recibido: '${raw}')`);
  }
  return url.href.replace(/\/+$/, "");
}

// --- Validación de la región (mismas reglas que scripts/region.sh) -----------

const NUMBER = /^-?\d+(\.\d+)?$/;

export function parseRegionName(raw: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new Error(`REGION_NAME debe ser minúsculas, números y guiones (recibido: '${raw}')`);
  }
  return raw;
}

export function parseCenter(raw: string): [number, number] {
  const parts = raw.split(",");
  const [lonText, latText] = parts;
  if (parts.length !== 2 || !lonText || !latText || !NUMBER.test(lonText) || !NUMBER.test(latText)) {
    throw new Error(`REGION_CENTER debe ser "lon,lat" en grados decimales (recibido: '${raw}')`);
  }
  const lon = Number(lonText);
  const lat = Number(latText);
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`REGION_CENTER fuera de rango: lon entre -180 y 180, lat entre -90 y 90 (recibido: '${raw}')`);
  }
  return [lon, lat];
}

export function parseBbox(raw: string): [number, number, number, number] {
  const parts = raw.split(",");
  if (parts.length !== 4 || !parts.every((part) => NUMBER.test(part))) {
    throw new Error(`REGION_BBOX debe ser "oeste,sur,este,norte" en grados decimales (recibido: '${raw}')`);
  }
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error(`REGION_BBOX fuera de rango o invertida (recibido: '${raw}')`);
  }
  return [west, south, east, north];
}

export function parseZoom(raw: string): number {
  const zoom = Number(raw);
  if (!NUMBER.test(raw) || zoom < 0 || zoom > 22) {
    throw new Error(`REGION_ZOOM debe ser un número entre 0 y 22 (recibido: '${raw}')`);
  }
  return zoom;
}

// --- Estilo -------------------------------------------------------------------

export function buildStyle(options: StyleOptions): StyleSpecification {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const flavor = FLAVORS[options.variant];

  return {
    version: 8,
    name: `${TITLE[options.variant][options.lang]} (${options.lang.toUpperCase()})`,
    metadata: {
      "veni:version": options.version,
      "veni:variant": options.variant,
      "veni:lang": options.lang,
      "veni:region": options.region,
      "veni:base_url": baseUrl,
      "veni:protomaps_build": options.protomapsBuild,
      // El extracto guarda tiles enteros: en zooms bajos un tile cubre medio
      // continente (en z0, el planeta). Los visores usan esta caja como
      // maxBounds para no salir de la región.
      "veni:bounds": options.bounds,
    },
    center: options.center,
    zoom: options.zoom,
    glyphs: `${baseUrl}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${baseUrl}/sprites/${SPRITE[options.variant]}`,
    sources: {
      [SOURCE]: {
        type: "vector",
        url: `pmtiles://${baseUrl}/${options.region}.pmtiles`,
        attribution: ATTRIBUTION[options.lang],
      },
    },
    layers: layers(SOURCE, flavor, { lang: options.lang }).map(brandLayer),
  };
}

/**
 * Fontstacks que un estilo puede pedir: `text-font` de las capas, las opciones
 * `text-font` de las expresiones `format` dentro de `text-field` y, en capas
 * symbol con texto pero sin `text-font`, la fuente por defecto de MapLibre.
 *
 * Un valor de `text-font` es una lista de fuentes (["A", "B"]) o una
 * expresión; dentro de una expresión, las listas de fuentes van en
 * ["literal", [...]]. El resto de strings son operadores o propiedades.
 */
export function fontsUsed(style: StyleSpecification): Set<string> {
  const found = new Set<string>();

  const collectFontValue = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length > 0 && value.every((item) => typeof item === "string") && !isExpression(value)) {
      value.forEach((font: string) => found.add(font));
    } else {
      collectFromExpression(value);
    }
  };

  const collectFromExpression = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value[0] === "literal" && Array.isArray(value[1])) {
      value[1].forEach((font) => typeof font === "string" && found.add(font));
      return;
    }
    value.forEach(collectFromExpression);
  };

  const collectFromField = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(collectFromField);
    else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "text-font") collectFontValue(inner);
        else collectFromField(inner);
      }
    }
  };

  for (const layer of style.layers) {
    if (layer.type !== "symbol" || !layer.layout) continue;
    const layout = layer.layout as Record<string, unknown>;
    if (layout["text-field"] !== undefined && layout["text-font"] === undefined) {
      MAPLIBRE_DEFAULT_FONTS.forEach((font) => found.add(font));
    }
    collectFontValue(layout["text-font"]);
    collectFromField(layout["text-field"]);
  }
  return found;
}

// Una lista de fuentes nunca empieza con un operador de expresión.
const EXPRESSION_OPERATORS = new Set(["literal", "case", "match", "step", "coalesce", "get", "let", "var", "interpolate"]);
function isExpression(value: string[]): boolean {
  return EXPRESSION_OPERATORS.has(value[0] ?? "");
}
