// Paletas Vení para @protomaps/basemaps.
//
// Se parte de los flavors "light" y "dark" de Protomaps y se reemplazan los
// colores con la marca (brand/tokens.css de veni-roldanillo):
//   ciruela #2A1638 · ciruela suave #6A5578 · arrebol #F0525A · mango #F7A93B · lila #F3ECF6
//
// Reglas de la marca que se respetan aquí:
// - Arrebol solo en formas (autopistas, POI grandes), nunca en texto pequeño
//   sobre fondo claro: no llega a 4.5:1.
// - Todo texto de etiqueta llega a 4.5:1 contra su halo (tests/style/).
import { namedFlavor, type Flavor } from "@protomaps/basemaps";

export const BRAND = {
  ciruela: "#2A1638",
  ciruelaSuave: "#6A5578",
  arrebol: "#F0525A",
  mango: "#F7A93B",
  lila: "#F3ECF6",
  blanco: "#FFFFFF",
} as const;

// Fontstacks generados por `make assets` (config/fontstacks.yml).
export const FONTS = {
  regular: "Figtree Regular",
  bold: "Figtree SemiBold",
  italic: "Figtree Italic",
  places: "Bricolage Grotesque Bold",
} as const;

const fonts = { regular: FONTS.regular, bold: FONTS.bold, italic: FONTS.italic };

// Claro: tierra lila de la marca, calles blancas con borde lila, vías
// principales en mango y autopistas en arrebol; etiquetas en ciruela.
export const CLARO: Flavor = {
  ...namedFlavor("light"),
  ...fonts,
  // Lila de la marca: las calles blancas se distinguen desde zoom 14.
  background: BRAND.lila,
  earth: BRAND.lila,
  park_a: "#DDEBD6",
  park_b: "#BFDDB0",
  wood_a: "#DCE9D4",
  wood_b: "#B8D8A8",
  scrub_a: "#E3ECD9",
  scrub_b: "#C9DFB9",
  pedestrian: "#EFE7F2",
  hospital: "#F5E1E3",
  school: "#F4EBDD",
  industrial: "#ECE6EF",
  aerodrome: "#ECE8EF",
  water: "#BCD8E8",
  buildings: "#E6DCEB",
  pier: "#E6DCEB",
  sand: "#F3EBD7",
  beach: "#F6EDD2",
  zoo: "#DDEAD9",
  military: "#E8E2EA",
  railway: "#B5A7BF",
  boundaries: "#B9A6C4",

  other: "#FFFFFF",
  minor_service: "#FFFFFF",
  minor_a: "#FFFFFF",
  minor_b: "#FFFFFF",
  link: "#FFFFFF",
  major: "#FCE4BE",
  highway: "#F9C4C6",
  minor_service_casing: "#D9CBE1",
  minor_casing: "#D9CBE1",
  link_casing: "#D9CBE1",
  major_casing_early: "#F2C98A",
  major_casing_late: "#F2C98A",
  highway_casing_early: "#F0A0A5",
  highway_casing_late: "#F0A0A5",
  bridges_other: "#FFFFFF",
  bridges_minor: "#FFFFFF",
  bridges_link: "#FFFFFF",
  bridges_major: "#FCE4BE",
  bridges_highway: "#F9C4C6",
  bridges_other_casing: "#DCCDE3",
  bridges_minor_casing: "#DCCDE3",
  bridges_link_casing: "#DCCDE3",
  bridges_major_casing: "#EDBF7A",
  bridges_highway_casing: "#EC9096",

  roads_label_minor: BRAND.ciruelaSuave,
  roads_label_minor_halo: BRAND.blanco,
  roads_label_major: BRAND.ciruelaSuave,
  roads_label_major_halo: BRAND.blanco,
  ocean_label: "#2E4A66",
  subplace_label: BRAND.ciruelaSuave,
  subplace_label_halo: BRAND.blanco,
  city_label: BRAND.ciruela,
  city_label_halo: BRAND.blanco,
  state_label: BRAND.ciruelaSuave,
  state_label_halo: BRAND.blanco,
  country_label: BRAND.ciruelaSuave,
  address_label: BRAND.ciruelaSuave,
  address_label_halo: BRAND.blanco,

  // Etiquetas de POI (halo = tierra): tonos oscurecidos hasta 4.5:1. Comida en
  // mango oscuro, el color de la marca asociado a comer.
  pois: {
    blue: "#15668A",
    green: "#1C6B3F",
    lapis: "#2A4DB0",
    pink: "#A43381",
    red: "#B32F45",
    slategray: "#5E5080",
    tangerine: "#8F4A00",
    turquoise: "#00666F",
  },
};

// Oscuro: ciruela profunda como tierra, calles en ciruela más clara, vías
// principales en mango apagado, autopistas en arrebol oscuro; etiquetas en lila.
export const OSCURO: Flavor = {
  ...namedFlavor("dark"),
  ...fonts,
  background: "#1C0F26",
  earth: "#1C0F26",
  park_a: "#1F2A22",
  park_b: "#24382A",
  wood_a: "#1F2A22",
  wood_b: "#253A2B",
  scrub_a: "#222B23",
  scrub_b: "#28352A",
  pedestrian: "#2A1B35",
  hospital: "#35202C",
  school: "#2F2433",
  industrial: "#27192F",
  aerodrome: "#281B31",
  water: "#1D3346",
  buildings: "#2D1D3A",
  pier: "#2D1D3A",
  sand: "#2E2626",
  beach: "#322A26",
  zoo: "#222C25",
  military: "#271A2E",
  railway: "#5E4B6B",
  boundaries: "#6E5A7C",

  other: "#34233F",
  minor_service: "#34233F",
  minor_a: "#3B2947",
  minor_b: "#3B2947",
  link: "#3B2947",
  major: "#5B4127",
  highway: "#6A2B35",
  minor_service_casing: BRAND.ciruela,
  minor_casing: BRAND.ciruela,
  link_casing: BRAND.ciruela,
  major_casing_early: "#3D2A1A",
  major_casing_late: "#3D2A1A",
  highway_casing_early: "#471B23",
  highway_casing_late: "#471B23",
  bridges_other: "#3B2947",
  bridges_minor: "#3B2947",
  bridges_link: "#3B2947",
  bridges_major: "#5B4127",
  bridges_highway: "#6A2B35",
  bridges_other_casing: "#21122C",
  bridges_minor_casing: "#21122C",
  bridges_link_casing: "#21122C",
  bridges_major_casing: "#33231A",
  bridges_highway_casing: "#3A161D",

  roads_label_minor: "#CDBBD8",
  roads_label_minor_halo: BRAND.ciruela,
  roads_label_major: "#E3D6EA",
  roads_label_major_halo: BRAND.ciruela,
  ocean_label: "#9CC3E0",
  subplace_label: "#CDBBD8",
  subplace_label_halo: BRAND.ciruela,
  city_label: BRAND.lila,
  city_label_halo: BRAND.ciruela,
  state_label: "#CDBBD8",
  state_label_halo: BRAND.ciruela,
  country_label: "#CDBBD8",
  address_label: "#CDBBD8",
  address_label_halo: BRAND.ciruela,

  // POI sobre tierra ciruela: tonos claros hasta 4.5:1; comida en mango.
  pois: {
    blue: "#6FB6D6",
    green: "#5FD08F",
    lapis: "#93ABF5",
    pink: "#F28BCF",
    red: "#F5889E",
    slategray: "#B7A9D0",
    tangerine: BRAND.mango,
    turquoise: "#4FD6E2",
  },
};

export const FLAVORS = { claro: CLARO, oscuro: OSCURO } as const;
export type Variant = keyof typeof FLAVORS;
