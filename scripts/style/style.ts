// Construye un estilo MapLibre de Vení a partir de @protomaps/basemaps.
// Función pura: no lee ni escribe archivos (eso lo hace build.ts).
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { layers } from "@protomaps/basemaps";
import { FLAVORS, FONTS, type Variant } from "./flavors.ts";

export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const VARIANTS = Object.keys(FLAVORS) as Variant[];

// Nombre del source dentro del estilo: las capas de basemaps lo referencian.
const SOURCE = "protomaps";

// Capas de lugares que llevan la tipografía de títulos de la marca.
const PLACE_LAYERS = new Set(["places_locality", "places_region", "places_country"]);

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
  zoom: number;
  version: string;
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

function brandLayer(layer: LayerSpecification): LayerSpecification {
  if (!("layout" in layer) || !layer.layout) return layer;
  const layout = replaceFonts(layer.layout) as Record<string, unknown>;
  if (PLACE_LAYERS.has(layer.id) && "text-font" in layout) {
    layout["text-font"] = [FONTS.places];
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
  if (url.search || url.hash) {
    throw new Error(`STYLE_BASE_URL no puede tener query ni fragmento (recibido: '${raw}')`);
  }
  return url.href.replace(/\/+$/, "");
}

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
 * Fontstacks que un estilo puede pedir, en `text-font` de las capas y en las
 * opciones `text-font` de las expresiones `format` dentro de `text-field`.
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
    if (!("layout" in layer) || !layer.layout) continue;
    const layout = layer.layout as Record<string, unknown>;
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
