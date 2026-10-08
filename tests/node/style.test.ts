// Pruebas del generador de estilos (node --test, sin red ni archivos de build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification, SymbolLayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { layers } from "@protomaps/basemaps";
import { BRAND, FLAVORS, mix } from "../../scripts/style/flavors.ts";
import {
  buildStyle,
  fontsUsed,
  HIDDEN_POI_KINDS,
  LANGS,
  normalizeBaseUrl,
  parseBbox,
  parseCenter,
  parseRegionName,
  parseZoom,
  PLACE_LAYERS,
  VARIANTS,
  type StyleOptions,
} from "../../scripts/style/style.ts";

const base: Omit<StyleOptions, "variant" | "lang"> = {
  baseUrl: "https://tiles.example.com/v0.1.0/",
  region: "roldanillo",
  center: [-76.1547, 4.4128],
  bounds: [-76.3, 4.3, -76.0, 4.55],
  zoom: 13.5,
  version: "0.1.0",
  protomapsBuild: "20260928",
};

const combos = VARIANTS.flatMap((variant) => LANGS.map((lang) => ({ variant, lang })));
const styles = new Map(combos.map((combo) => [`${combo.variant}-${combo.lang}`, buildStyle({ ...base, ...combo })]));
const styleFor = (key: string): StyleSpecification => {
  const style = styles.get(key);
  assert.ok(style, `falta el estilo ${key}`);
  return style;
};
const symbolLayer = (style: StyleSpecification, id: string): SymbolLayerSpecification => {
  const layer = style.layers.find((l) => l.id === id);
  assert.ok(layer?.type === "symbol", `falta la capa symbol ${id}`);
  return layer;
};

// Tipos de POI que deja pasar el filtro de la capa `pois`: una lista de
// permitidos, ["in", ["get", "kind"], ["literal", [...]]], dentro de un "all".
const poiKinds = (layers: readonly LayerSpecification[]): string[] => {
  const layer = layers.find((l) => l.id === "pois");
  assert.ok(layer && "filter" in layer && Array.isArray(layer.filter), "falta el filtro de la capa pois");
  const allowed = (layer.filter as unknown[]).find(
    (part): part is ["in", ["get", "kind"], ["literal", string[]]] =>
      Array.isArray(part) && part[0] === "in" && JSON.stringify(part[1]) === '["get","kind"]',
  );
  assert.ok(allowed, "el filtro de pois ya no es una lista de tipos permitidos");
  return allowed[2][1];
};

// Fontstacks que genera `make assets`: claves de config/fontstacks.yml.
const publishedFonts = new Set(
  readFileSync("config/fontstacks.yml", "utf8")
    .split("\n")
    .map((line) => /^([A-Za-z0-9][A-Za-z0-9 ]*):/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined),
);

describe("estructura", () => {
  for (const [key, style] of styles) {
    it(`${key} es un estilo válido según la especificación de MapLibre`, () => {
      assert.deepEqual(validateStyleMin(style), []);
    });

    it(`${key} apunta al PMTiles, los glyphs y los sprites de la URL base`, () => {
      const source = style.sources.protomaps;
      assert.ok(source && source.type === "vector");
      assert.equal(source.url, "pmtiles://https://tiles.example.com/v0.1.0/roldanillo.pmtiles");
      assert.equal(style.glyphs, "https://tiles.example.com/v0.1.0/fonts/{fontstack}/{range}.pbf");
      assert.match(String(style.sprite), /^https:\/\/tiles\.example\.com\/v0\.1\.0\/sprites\/(light|dark)$/);
      assert.deepEqual(style.center, [-76.1547, 4.4128]);
    });

    it(`${key} registra versión, base y build de Protomaps en los metadatos`, () => {
      assert.deepEqual(
        {
          version: (style.metadata as Record<string, unknown>)["veni:version"],
          base: (style.metadata as Record<string, unknown>)["veni:base_url"],
          build: (style.metadata as Record<string, unknown>)["veni:protomaps_build"],
        },
        { version: "0.1.0", base: "https://tiles.example.com/v0.1.0", build: "20260928" },
      );
      assert.deepEqual((style.metadata as Record<string, unknown>)["veni:bounds"], [-76.3, 4.3, -76.0, 4.55]);
    });

    it(`${key} lleva la atribución de OpenStreetMap`, () => {
      const source = style.sources.protomaps;
      assert.ok(source && "attribution" in source);
      assert.match(String(source.attribution), /OpenStreetMap/);
    });
  }

  it("el sprite corresponde a la variante", () => {
    assert.match(String(styleFor("claro-es").sprite), /\/light$/);
    assert.match(String(styleFor("oscuro-es").sprite), /\/dark$/);
  });

  it("los POI sin ícono propio en el sprite caen en un ícono de respaldo", () => {
    const icon = symbolLayer(styleFor("claro-es"), "pois").layout?.["icon-image"];
    assert.ok(Array.isArray(icon));
    assert.equal(icon[0], "coalesce");
    assert.deepEqual(icon.at(-1), ["image", "townspot"]);
  });
});

describe("puntos de interés", () => {
  for (const key of styles.keys()) {
    it(`${key} no dibuja los locales de comida`, () => {
      const kinds = poiKinds(styleFor(key).layers);
      assert.deepEqual(HIDDEN_POI_KINDS.filter((kind) => kinds.includes(kind)), []);
    });
  }

  it("los demás puntos de interés siguen en el mapa", () => {
    const upstream = poiKinds(layers("protomaps", FLAVORS.claro, { lang: "es" }));
    const hidden = new Set<string>(HIDDEN_POI_KINDS);
    assert.deepEqual(poiKinds(styleFor("claro-es").layers), upstream.filter((kind) => !hidden.has(kind)));
  });

  it("HIDDEN_POI_KINDS no nombra tipos que basemaps ya no dibuja", () => {
    const upstream = poiKinds(layers("protomaps", FLAVORS.claro, { lang: "es" }));
    assert.deepEqual(HIDDEN_POI_KINDS.filter((kind) => !upstream.includes(kind)), []);
  });
});

describe("tipografías", () => {
  for (const [key, style] of styles) {
    it(`${key} solo pide fontstacks que publica make assets`, () => {
      const used = fontsUsed(style);
      assert.ok(used.size > 0, "el estilo no pide ninguna fuente");
      const missing = [...used].filter((font) => !publishedFonts.has(font));
      assert.deepEqual(missing, [], `fuentes sin publicar: ${missing.join(", ")}`);
    });

    // Lista fija (issue #5), no PLACE_LAYERS: quitar una capa de la constante
    // también tiene que hacer fallar la prueba.
    for (const id of ["places_locality", "places_subplace", "places_region", "places_country"]) {
      it(`${key}: ${id} usa la tipografía de títulos de la marca`, () => {
        assert.deepEqual(symbolLayer(style, id).layout?.["text-font"], ["Bricolage Grotesque Bold"]);
      });
    }
  }

  it("fontsUsed encuentra fuentes dentro de expresiones y de format", () => {
    const style = {
      version: 8,
      sources: {},
      layers: [
        { id: "a", type: "symbol", source: "s", layout: { "text-font": ["case", ["has", "x"], ["literal", ["Uno"]], ["literal", ["Dos"]]] } },
        { id: "b", type: "symbol", source: "s", layout: { "text-font": ["Tres"], "text-field": ["format", ["get", "name"], { "text-font": ["literal", ["Cuatro"]] }] } },
      ],
    } as StyleSpecification;
    assert.deepEqual([...fontsUsed(style)].sort(), ["Cuatro", "Dos", "Tres", "Uno"]);
  });

  it("fontsUsed cuenta la fuente por defecto de MapLibre si falta text-font", () => {
    const style = {
      version: 8,
      sources: {},
      layers: [{ id: "a", type: "symbol", source: "s", layout: { "text-field": ["get", "name"] } }],
    } as StyleSpecification;
    assert.ok(fontsUsed(style).has("Open Sans Regular"));
  });
});

describe("idiomas", () => {
  it("las etiquetas en español prefieren name:es y en inglés name:en", () => {
    const field = (key: string) => JSON.stringify(symbolLayer(styleFor(key), "places_locality").layout);
    assert.match(field("claro-es"), /"name:es"/);
    assert.doesNotMatch(field("claro-en"), /"name:es"/);
    assert.match(field("claro-en"), /"name:en"/);
  });

  it("nombre y atribución en el idioma del estilo", () => {
    assert.equal(styleFor("claro-es").name, "Vení · Claro (ES)");
    assert.equal(styleFor("oscuro-en").name, "Vení · Dark (EN)");
    assert.match(String((styleFor("claro-es").sources.protomaps as { attribution: string }).attribution), /colaboradores/);
    assert.match(String((styleFor("claro-en").sources.protomaps as { attribution: string }).attribution), /contributors/);
  });
});

// --- Contraste sobre el estilo generado ----------------------------------------

// Contraste WCAG 2.x: la marca exige 4.5:1 en texto.
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match?.[1], `color no hexadecimal: ${hex}`);
  const channels = [0, 2, 4].map((i) => parseInt(match[1]!.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Colores hex literales de una propiedad (valor fijo o ramas de una expresión). */
function hexColors(value: unknown): string[] {
  if (typeof value === "string") return /^#[0-9a-f]{6}$/i.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(hexColors);
  return [];
}

// Capas con texto sin halo, con el motivo. Cualquier otra sin halo falla.
const WITHOUT_HALO: Record<string, string> = {
  // El número va sobre el escudo del sprite (blanco en claro, negro en oscuro).
  roads_shields: "texto sobre el ícono del escudo",
};

const textLayers = (style: StyleSpecification): SymbolLayerSpecification[] =>
  style.layers.filter(
    (l: LayerSpecification): l is SymbolLayerSpecification => l.type === "symbol" && l.layout?.["text-field"] !== undefined,
  );

describe("contraste y marca", () => {
  for (const [key, style] of styles) {
    for (const layer of textLayers(style)) {
      it(`${key}: ${layer.id} llega a 4.5:1 contra su halo`, () => {
        const halos = hexColors(layer.paint?.["text-halo-color"]);
        if (halos.length === 0) {
          assert.ok(WITHOUT_HALO[layer.id], `${layer.id} tiene texto sin halo y no está en WITHOUT_HALO`);
          return;
        }
        assert.equal(halos.length, 1, `${layer.id}: halo que depende de datos`);
        const halo = halos[0]!;
        const colors = hexColors(layer.paint?.["text-color"]);
        assert.ok(colors.length > 0, `${layer.id} no tiene color de texto literal`);

        // pois: la rama por defecto del case repite el halo, pero el filtro de
        // la capa solo deja pasar los tipos con color propio.
        const expression = layer.paint?.["text-color"];
        const unreachable = layer.id === "pois" && Array.isArray(expression) && expression.at(-1) === halo ? 1 : 0;
        const checked = colors.slice(0, colors.length - unreachable);

        const low = checked
          .map((color) => [color, contrast(color, halo)] as const)
          .filter(([, ratio]) => ratio < 4.5)
          .map(([color, ratio]) => `${color} sobre ${halo}: ${ratio.toFixed(2)}:1`);
        assert.deepEqual(low, []);
      });
    }
  }

  it("PLACE_LAYERS no nombra capas que basemaps ya no genera", () => {
    const ids = new Set(styleFor("claro-es").layers.map((l) => l.id));
    assert.deepEqual(PLACE_LAYERS.filter((id) => !ids.has(id)), []);
  });

  it("la lista de capas sin halo no tiene entradas viejas", () => {
    const ids = new Set(textLayers(styleFor("claro-es")).map((l) => l.id));
    assert.deepEqual(Object.keys(WITHOUT_HALO).filter((id) => !ids.has(id)), []);
  });

  it("arrebol nunca es color de texto en el estilo claro", () => {
    const colors = textLayers(styleFor("claro-es")).flatMap((l) => hexColors(l.paint?.["text-color"]).map((c) => c.toUpperCase()));
    assert.ok(!colors.includes(BRAND.arrebol.toUpperCase()));
  });

  it("los tintes de vías salen de la marca", () => {
    assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
    assert.equal(mix(BRAND.arrebol, BRAND.blanco, 0), BRAND.arrebol);
  });
});

describe("entradas", () => {
  it("URL base: quita la barra final", () => {
    assert.equal(normalizeBaseUrl("https://a.example/x/"), "https://a.example/x");
  });
  for (const bad of [
    "tiles/",
    "ftp://a.example",
    "https://a.example/?v=1",
    "https://a.example/#x",
    "https://a.example/?",
    "https://a.example/#",
    "https://u:p@a.example",
  ]) {
    it(`URL base: rechaza '${bad}'`, () => {
      assert.throws(() => normalizeBaseUrl(bad), /STYLE_BASE_URL/);
    });
  }

  it("centro: acepta lon,lat", () => {
    assert.deepEqual(parseCenter("-76.1547,4.4128"), [-76.1547, 4.4128]);
  });
  for (const bad of ["0x10,5", "-176.1,95", "4.41", "4.41,-76.15,1", "a,b", "", "1e2,3"]) {
    it(`centro: rechaza '${bad}'`, () => {
      assert.throws(() => parseCenter(bad), /REGION_CENTER/);
    });
  }
  it("caja: acepta oeste,sur,este,norte", () => {
    assert.deepEqual(parseBbox("-76.30,4.30,-76.00,4.55"), [-76.3, 4.3, -76, 4.55]);
  });
  for (const bad of ["-76.00,4.30,-76.30,4.55", "-76.30,4.55,-76.00,4.30", "-76.3,4.3,-76", "a,b,c,d", "-190,4.3,-76,4.55"]) {
    it(`caja: rechaza '${bad}'`, () => {
      assert.throws(() => parseBbox(bad), /REGION_BBOX/);
    });
  }
  for (const bad of ["0x10", "23", "-1", "", "13,5"]) {
    it(`zoom: rechaza '${bad}'`, () => {
      assert.throws(() => parseZoom(bad), /REGION_ZOOM/);
    });
  }
  for (const bad of ["a b?x", "Roldanillo", "-x", ""]) {
    it(`región: rechaza '${bad}'`, () => {
      assert.throws(() => parseRegionName(bad), /REGION_NAME/);
    });
  }
});
