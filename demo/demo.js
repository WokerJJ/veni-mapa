// Demo del mapa de Roldanillo: MapLibre GL + PMTiles, autohospedados.
//
// - Tema (claro/oscuro) e idioma (es/en) cambian el estilo sin mover la cámara.
// - Lo que elegís queda en la URL (?tema=oscuro&idioma=en) para compartir la vista.
// - Sin tema elegido, la demo sigue la preferencia del sistema, también si cambia.
// - La cámara no sale de la región del extracto (veni:bounds del estilo).
import * as maplibregl from "./vendor/maplibre-gl.mjs";

const TEXTOS = {
  es: {
    subtitulo: "Mapa de Roldanillo",
    opciones: "Opciones del mapa",
    tema: "Tema",
    claro: "Claro",
    oscuro: "Oscuro",
    idioma: "Idioma",
    titulo: "Vení · Mapa de Roldanillo",
  },
  en: {
    subtitulo: "Roldanillo map",
    opciones: "Map options",
    tema: "Theme",
    claro: "Light",
    oscuro: "Dark",
    idioma: "Language",
    titulo: "Vení · Roldanillo map",
  },
};

// Textos de los controles de MapLibre (por defecto vienen en inglés).
const TEXTOS_MAPLIBRE = {
  es: {
    "Map.Title": "Mapa de Roldanillo",
    "NavigationControl.ZoomIn": "Acercar",
    "NavigationControl.ZoomOut": "Alejar",
    "NavigationControl.ResetBearing": "Arrastrá para rotar el mapa; hacé clic para volver al norte",
    "AttributionControl.ToggleAttribution": "Mostrar u ocultar la atribución",
    "ScaleControl.Meters": "m",
    "ScaleControl.Kilometers": "km",
  },
  en: {
    "Map.Title": "Map of Roldanillo",
    "NavigationControl.ZoomIn": "Zoom in",
    "NavigationControl.ZoomOut": "Zoom out",
    "NavigationControl.ResetBearing": "Drag to rotate map, click to reset north",
    "AttributionControl.ToggleAttribution": "Toggle attribution",
    "ScaleControl.Meters": "m",
    "ScaleControl.Kilometers": "km",
  },
};

const TEMAS = ["claro", "oscuro"];
const IDIOMAS = ["es", "en"];

const params = new URLSearchParams(location.search);
const sistemaOscuro = matchMedia("(prefers-color-scheme: dark)");
const temaElegido = TEMAS.includes(params.get("tema")) ? params.get("tema") : null;
const estado = {
  tema: temaElegido ?? (sistemaOscuro.matches ? "oscuro" : "claro"),
  idioma: IDIOMAS.includes(params.get("idioma")) ? params.get("idioma") : navigator.language.startsWith("en") ? "en" : "es",
};
// Solo lo que la persona eligió va a la URL; lo demás sigue al sistema.
const elegidos = new Set(temaElegido ? ["tema"] : []);
if (IDIOMAS.includes(params.get("idioma"))) elegidos.add("idioma");

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

// MapLibre lee su locale solo al crear el mapa: al cambiar de idioma se
// actualizan a mano los nombres accesibles de sus controles y del lienzo.
function aplicarTextosMapa(mapa) {
  const t = TEXTOS_MAPLIBRE[estado.idioma];
  const etiquetar = (selector, texto) => {
    for (const el of mapa.getContainer().querySelectorAll(selector)) {
      el.setAttribute("aria-label", texto);
      el.setAttribute("title", texto);
    }
  };
  mapa.getCanvas().setAttribute("aria-label", t["Map.Title"]);
  etiquetar(".maplibregl-ctrl-zoom-in", t["NavigationControl.ZoomIn"]);
  etiquetar(".maplibregl-ctrl-zoom-out", t["NavigationControl.ZoomOut"]);
  etiquetar(".maplibregl-ctrl-compass", t["NavigationControl.ResetBearing"]);
  etiquetar(".maplibregl-ctrl-attrib-button", t["AttributionControl.ToggleAttribution"]);
}

function guardarEnUrl() {
  const url = new URL(location.href);
  for (const clave of ["tema", "idioma"]) {
    if (elegidos.has(clave)) url.searchParams.set(clave, estado[clave]);
    else url.searchParams.delete(clave);
  }
  history.replaceState(null, "", url);
}

// PMTiles pide rangos HTTP del archivo en vez de tiles sueltos.
const protocolo = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocolo.tile);

aplicarTextos();

// El estilo se lee antes de crear el mapa para pasarle su center y su zoom
// (config/region.yml) de forma explícita. Si el mapa arranca sin cámara, parte
// de 0,0 en zoom 0, salta al centro del estilo al cargarlo y los tiles ya
// cargados no se dibujan hasta el primer movimiento: el mapa se ve vacío.
const estiloInicial = await (await fetch(urlEstilo())).json();
const limites = estiloInicial.metadata?.["veni:bounds"];

const mapa = new maplibregl.Map({
  container: "mapa",
  style: estiloInicial,
  center: estiloInicial.center,
  zoom: estiloInicial.zoom,
  // El extracto guarda tiles enteros: en zooms bajos cubren medio continente.
  // Con maxBounds la cámara no sale de la región y no se ve el resto del mundo.
  maxBounds: Array.isArray(limites) && limites.length === 4 ? limites : undefined,
  attributionControl: { compact: false },
  hash: "vista",
  locale: TEXTOS_MAPLIBRE[estado.idioma],
});
mapa.addControl(new maplibregl.NavigationControl(), "top-right");
mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
mapa.once("load", () => aplicarTextosMapa(mapa));

function cambiar(cambios) {
  const claves = Object.keys(cambios);
  for (const clave of claves) elegidos.add(clave);
  // Pulsar la opción que ya está activa no recarga nada.
  if (claves.every((clave) => estado[clave] === cambios[clave])) {
    guardarEnUrl();
    return;
  }
  Object.assign(estado, cambios);
  aplicarTextos();
  aplicarTextosMapa(mapa);
  guardarEnUrl();
  // diff: false recarga el estilo completo. Los sprites claro y oscuro usan los
  // mismos nombres de íconos y el cambio "por diferencia" deja el atlas de
  // imágenes a medio actualizar en algunos navegadores.
  mapa.setStyle(urlEstilo(), { diff: false });
}

for (const boton of document.querySelectorAll("[data-tema]")) {
  boton.addEventListener("click", () => cambiar({ tema: boton.dataset.tema }));
}
for (const boton of document.querySelectorAll("[data-idioma]")) {
  boton.addEventListener("click", () => cambiar({ idioma: boton.dataset.idioma }));
}

// Mientras no se elija un tema, se sigue la preferencia del sistema.
sistemaOscuro.addEventListener("change", (evento) => {
  if (elegidos.has("tema")) return;
  const tema = evento.matches ? "oscuro" : "claro";
  if (tema === estado.tema) return;
  estado.tema = tema;
  aplicarTextos();
  mapa.setStyle(urlEstilo(), { diff: false });
});

// Para las pruebas de render (issue #6) y para depurar desde la consola.
window.veniMapa = mapa;
