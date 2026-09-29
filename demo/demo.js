// Demo del mapa de Roldanillo: MapLibre GL + PMTiles, autohospedados.
//
// - Tema (claro/oscuro) e idioma (es/en) cambian el estilo sin mover la cámara.
// - Se guardan en la URL (?tema=oscuro&idioma=en) para poder compartir la vista.
// - Sin tema en la URL, se sigue la preferencia del sistema.
import * as maplibregl from "./vendor/maplibre-gl.mjs";

const TEXTOS = {
  es: {
    subtitulo: "Mapa de Roldanillo",
    opciones: "Opciones del mapa",
    tema: "Tema",
    claro: "Claro",
    oscuro: "Oscuro",
    idioma: "Idioma",
    mapa: "Mapa de Roldanillo",
    titulo: "Vení · Mapa de Roldanillo",
  },
  en: {
    subtitulo: "Roldanillo map",
    opciones: "Map options",
    tema: "Theme",
    claro: "Light",
    oscuro: "Dark",
    idioma: "Language",
    mapa: "Map of Roldanillo",
    titulo: "Vení · Roldanillo map",
  },
};

const TEMAS = ["claro", "oscuro"];
const IDIOMAS = ["es", "en"];

const params = new URLSearchParams(location.search);
const prefiereOscuro = matchMedia("(prefers-color-scheme: dark)").matches;
const estado = {
  tema: TEMAS.includes(params.get("tema")) ? params.get("tema") : prefiereOscuro ? "oscuro" : "claro",
  idioma: IDIOMAS.includes(params.get("idioma")) ? params.get("idioma") : navigator.language.startsWith("en") ? "en" : "es",
};

const urlEstilo = () => new URL(`style/veni-${estado.tema}-${estado.idioma}.json`, location.href).href;

function aplicarTextos() {
  const textos = TEXTOS[estado.idioma];
  document.documentElement.lang = estado.idioma;
  document.title = textos.titulo;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = textos[el.dataset.i18n];
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", textos[el.dataset.i18nAria]);
  for (const boton of document.querySelectorAll("[data-tema]")) boton.setAttribute("aria-pressed", String(boton.dataset.tema === estado.tema));
  for (const boton of document.querySelectorAll("[data-idioma]")) boton.setAttribute("aria-pressed", String(boton.dataset.idioma === estado.idioma));
}

function guardarEnUrl() {
  const url = new URL(location.href);
  url.searchParams.set("tema", estado.tema);
  url.searchParams.set("idioma", estado.idioma);
  history.replaceState(null, "", url);
}

// PMTiles pide rangos HTTP del archivo en vez de tiles sueltos.
const protocolo = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocolo.tile);

aplicarTextos();

// Sin center ni zoom en las opciones: así MapLibre usa los del estilo
// (config/region.yml). Pasar solo zoom haría ignorar el center del estilo.
const mapa = new maplibregl.Map({
  container: "mapa",
  style: urlEstilo(),
  attributionControl: { compact: false },
  hash: "vista",
});
mapa.addControl(new maplibregl.NavigationControl(), "top-right");
mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

function cambiar(cambios) {
  Object.assign(estado, cambios);
  aplicarTextos();
  guardarEnUrl();
  mapa.setStyle(urlEstilo());
}

for (const boton of document.querySelectorAll("[data-tema]")) {
  boton.addEventListener("click", () => cambiar({ tema: boton.dataset.tema }));
}
for (const boton of document.querySelectorAll("[data-idioma]")) {
  boton.addEventListener("click", () => cambiar({ idioma: boton.dataset.idioma }));
}

// Para las pruebas de render (issue #6) y para depurar desde la consola.
window.veniMapa = mapa;
