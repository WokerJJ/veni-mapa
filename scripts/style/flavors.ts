// Paletas Vení para @protomaps/basemaps.
//
// Se parte de los flavors "light" y "dark" de Protomaps y se reemplazan los
// colores con la marca (brand/tokens.css de veni-roldanillo):
//   ciruela #2A1638 · ciruela suave #6A5578 · arrebol #F0525A · mango #F7A93B · lila #F3ECF6
//
// Reglas de la marca que se respetan aquí:
// - Arrebol solo en formas (tintes de arrebol en autopistas), nunca en texto
//   pequeño sobre fondo claro: no llega a 4.5:1.
// - Todo texto de etiqueta llega a 4.5:1 contra su halo (tests/node/).
//
// Los tintes de vías salen de los tokens con mix(): si cambia la marca, cambian.
import { namedFlavor, type Flavor } from "@protomaps/basemaps";

export const BRAND = {
  ciruela: "#2A1638",
  ciruelaSuave: "#6A5578",
  arrebol: "#F0525A",
  mango: "#F7A93B",
  lila: "#F3ECF6",
  blanco: "#FFFFFF",
} as const;

/** Mezcla dos colores hex: t = 0 devuelve `from`, t = 1 devuelve `to`. */
export function mix(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const parts = [0, 1, 2].map((i) => Math.round(channel(from, i) * (1 - t) + channel(to, i) * t));
  return `#${parts.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// Tintes de vías: principales en mango, autopistas en arrebol.
const MAJOR_CLARO = mix(BRAND.mango, BRAND.blanco, 0.65);
const MAJOR_CASING_CLARO = mix(BRAND.mango, BRAND.blanco, 0.4);
const HIGHWAY_CLARO = mix(BRAND.arrebol, BRAND.blanco, 0.65);
const HIGHWAY_CASING_CLARO = mix(BRAND.arrebol, BRAND.blanco, 0.4);
const MAJOR_OSCURO = mix(BRAND.mango, BRAND.ciruela, 0.7);
const MAJOR_CASING_OSCURO = mix(BRAND.mango, BRAND.ciruela, 0.85);
const HIGHWAY_OSCURO = mix(BRAND.arrebol, BRAND.ciruela, 0.65);
const HIGHWAY_CASING_OSCURO = mix(BRAND.arrebol, BRAND.ciruela, 0.82);

// Fontstacks generados por `make assets` (config/fontstacks.yml).
export const FONTS = {
  regular: "Figtree Regular",
  bold: "Figtree SemiBold",
  italic: "Figtree Italic",
  places: "Bricolage Grotesque Bold",
} as const;

const fonts = { regular: FONTS.regular, bold: FONTS.bold, italic: FONTS.italic };

// Claro: tierra lila de la marca, calles blancas con borde lila, vías
// principales en tinte de mango y autopistas en tinte de arrebol; etiquetas en
// ciruela.
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
  major: MAJOR_CLARO,
  highway: HIGHWAY_CLARO,
  minor_service_casing: "#D9CBE1",
  minor_casing: "#D9CBE1",
  link_casing: "#D9CBE1",
  major_casing_early: MAJOR_CASING_CLARO,
  major_casing_late: MAJOR_CASING_CLARO,
  highway_casing_early: HIGHWAY_CASING_CLARO,
  highway_casing_late: HIGHWAY_CASING_CLARO,
  bridges_other: "#FFFFFF",
  bridges_minor: "#FFFFFF",
  bridges_link: "#FFFFFF",
  bridges_major: MAJOR_CLARO,
  bridges_highway: HIGHWAY_CLARO,
  bridges_other_casing: "#DCCDE3",
  bridges_minor_casing: "#DCCDE3",
  bridges_link_casing: "#DCCDE3",
  bridges_major_casing: MAJOR_CASING_CLARO,
  bridges_highway_casing: HIGHWAY_CASING_CLARO,

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

  // Etiquetas de POI (halo = tierra): tonos oscurecidos hasta 4.5:1. El mango
  // oscuro era el de la comida, que el mapa base ya no dibuja (HIDDEN_POI_KINDS
  // en style.ts): se conserva porque basemaps espera el color.
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
// principales y autopistas en mango y arrebol mezclados con ciruela; etiquetas
// en lila.
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
  major: MAJOR_OSCURO,
  highway: HIGHWAY_OSCURO,
  minor_service_casing: BRAND.ciruela,
  minor_casing: BRAND.ciruela,
  link_casing: BRAND.ciruela,
  major_casing_early: MAJOR_CASING_OSCURO,
  major_casing_late: MAJOR_CASING_OSCURO,
  highway_casing_early: HIGHWAY_CASING_OSCURO,
  highway_casing_late: HIGHWAY_CASING_OSCURO,
  bridges_other: "#3B2947",
  bridges_minor: "#3B2947",
  bridges_link: "#3B2947",
  bridges_major: MAJOR_OSCURO,
  bridges_highway: HIGHWAY_OSCURO,
  bridges_other_casing: "#21122C",
  bridges_minor_casing: "#21122C",
  bridges_link_casing: "#21122C",
  bridges_major_casing: MAJOR_CASING_OSCURO,
  bridges_highway_casing: HIGHWAY_CASING_OSCURO,

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

  // POI sobre tierra ciruela: tonos claros hasta 4.5:1. El mango era el de la
  // comida, que el mapa base ya no dibuja; se conserva porque basemaps lo espera.
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
