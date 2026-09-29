// Pruebas del generador de estilos (node --test, sin red ni archivos de build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { BRAND, FLAVORS } from "../../scripts/style/flavors.ts";
import { buildStyle, fontsUsed, LANGS, normalizeBaseUrl, VARIANTS, type StyleOptions } from "../../scripts/style/style.ts";

const base: Omit<StyleOptions, "variant" | "lang"> = {
  baseUrl: "https://tiles.example.com/v0.1.0/",
  region: "roldanillo",
  center: [-76.1547, 4.4128],
  zoom: 13.5,
  version: "0.1.0",
};

const combos = VARIANTS.flatMap((variant) => LANGS.map((lang) => ({ variant, lang })));
const styles = new Map(combos.map((combo) => [`${combo.variant}-${combo.lang}`, buildStyle({ ...base, ...combo })]));
const styleFor = (key: string): StyleSpecification => {
  const style = styles.get(key);
  assert.ok(style, `falta el estilo ${key}`);
  return style;
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
});

describe("tipografías", () => {
  for (const [key, style] of styles) {
    it(`${key} solo pide fontstacks que publica make assets`, () => {
      const used = fontsUsed(style);
      assert.ok(used.size > 0, "el estilo no pide ninguna fuente");
      const missing = [...used].filter((font) => !publishedFonts.has(font));
      assert.deepEqual(missing, [], `fuentes sin publicar: ${missing.join(", ")}`);
    });
  }

  it("los lugares usan la tipografía de títulos de la marca", () => {
    const layer = styleFor("claro-es").layers.find((l) => l.id === "places_locality");
    assert.ok(layer?.type === "symbol");
    assert.deepEqual(layer.layout?.["text-font"], ["Bricolage Grotesque Bold"]);
  });

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
});

describe("idiomas", () => {
  it("las etiquetas en español prefieren name:es y en inglés name:en", () => {
    const field = (key: string) =>
      JSON.stringify(styleFor(key).layers.find((l) => l.id === "places_locality")?.layout);
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

describe("contraste y marca", () => {
  const pairs = [
    ["roads_label_minor", "roads_label_minor_halo"],
    ["roads_label_major", "roads_label_major_halo"],
    ["subplace_label", "subplace_label_halo"],
    ["city_label", "city_label_halo"],
    ["state_label", "state_label_halo"],
    ["address_label", "address_label_halo"],
  ] as const;

  for (const [variant, flavor] of Object.entries(FLAVORS)) {
    for (const [text, halo] of pairs) {
      it(`${variant}: ${text} llega a 4.5:1 contra su halo`, () => {
        const ratio = contrast(flavor[text], flavor[halo]);
        assert.ok(ratio >= 4.5, `${flavor[text]} sobre ${flavor[halo]}: ${ratio.toFixed(2)}:1`);
      });
    }
    for (const text of ["state_label", "country_label"] as const) {
      it(`${variant}: ${text} llega a 4.5:1 contra la tierra`, () => {
        const ratio = contrast(flavor[text], flavor.earth);
        assert.ok(ratio >= 4.5, `${flavor[text]} sobre ${flavor.earth}: ${ratio.toFixed(2)}:1`);
      });
    }
    // Las etiquetas de agua usan el color del agua como halo.
    it(`${variant}: ocean_label llega a 4.5:1 contra el agua`, () => {
      const ratio = contrast(flavor.ocean_label, flavor.water);
      assert.ok(ratio >= 4.5, `${flavor.ocean_label} sobre ${flavor.water}: ${ratio.toFixed(2)}:1`);
    });
    // Los POI usan la tierra como halo: restaurantes, parques, tiendas…
    it(`${variant}: todos los colores de POI llegan a 4.5:1 contra la tierra`, () => {
      assert.ok(flavor.pois, "el flavor no define colores de POI");
      const low = Object.entries(flavor.pois)
        .map(([name, color]) => [name, color, contrast(color, flavor.earth)] as const)
        .filter(([, , ratio]) => ratio < 4.5)
        .map(([name, color, ratio]) => `${name} ${color} ${ratio.toFixed(2)}:1`);
      assert.deepEqual(low, []);
    });
  }

  it("arrebol nunca es color de texto en el estilo claro", () => {
    const colors = styleFor("claro-es")
      .layers.filter((l) => l.type === "symbol")
      .map((l) => JSON.stringify(l.paint?.["text-color"] ?? "").toUpperCase());
    assert.ok(colors.every((c) => !c.includes(BRAND.arrebol.toUpperCase())));
  });
});

describe("URL base", () => {
  it("quita la barra final", () => {
    assert.equal(normalizeBaseUrl("https://a.example/x/"), "https://a.example/x");
  });
  for (const bad of ["tiles/", "ftp://a.example", "https://a.example/?v=1", "https://a.example/#x"]) {
    it(`rechaza '${bad}'`, () => {
      assert.throws(() => normalizeBaseUrl(bad), /STYLE_BASE_URL/);
    });
  }
});
