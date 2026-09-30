// Demo del mapa de Roldanillo: MapLibre GL + PMTiles, autohospedados.
//
// - Tema (claro/oscuro) e idioma (es/en) cambian el estilo sin mover la cámara.
// - Lo que elegís queda en la URL (?tema=oscuro&idioma=en) para compartir la vista.
// - Sin tema elegido, la demo sigue la preferencia del sistema, también si cambia.
// - La cámara no sale de la región del extracto (veni:bounds del estilo).
// - "¿Dónde estoy?" muestra la posición (queda en el navegador) y al tocar un
//   punto se dibuja la ruta a pie o en carro, calculada aquí con el router de
//   scripts/routing sobre el grafo de make routing, que se baja al primer toque.
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
    rutaTitulo: "Ruta",
    comoIr: "Cómo ir",
    aPie: "A pie",
    enCarro: "En carro",
    ruta: {
      "sin-posicion": "Tocá «¿Dónde estoy?» y después un punto del mapa para ver la ruta.",
      "pedir-posicion": "Primero tocá «¿Dónde estoy?»: la ruta sale desde tu posición.",
      listo: "Tocá un punto del mapa para ver la ruta.",
      calculando: "Calculando la ruta…",
      "sin-ruta": "Sin ruta: ese punto está lejos de las calles de Roldanillo.",
      fuera: "Tu posición está fuera de Roldanillo: la ruta no se puede calcular.",
      error: "No se pudo cargar la red de calles. Tocá el mapa para reintentar.",
      "sin-permiso": "Sin permiso para ver tu posición: activalo en el navegador.",
      foot: "a pie",
      car: "en carro",
    },
  },
  en: {
    subtitulo: "Roldanillo map",
    opciones: "Map options",
    tema: "Theme",
    claro: "Light",
    oscuro: "Dark",
    idioma: "Language",
    titulo: "Vení · Roldanillo map",
    rutaTitulo: "Route",
    comoIr: "How to go",
    aPie: "Walking",
    enCarro: "By car",
    ruta: {
      "sin-posicion": "Tap «Where am I?» and then a point on the map to see the route.",
      "pedir-posicion": "Tap «Where am I?» first: the route starts at your location.",
      listo: "Tap a point on the map to see the route.",
      calculando: "Calculating the route…",
      "sin-ruta": "No route: that point is far from the streets of Roldanillo.",
      fuera: "Your location is outside Roldanillo: the route can't be calculated.",
      error: "The street network couldn't be loaded. Tap the map to retry.",
      "sin-permiso": "No permission to see your location: allow it in the browser.",
      foot: "walking",
      car: "by car",
    },
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
    "GeolocateControl.FindMyLocation": "¿Dónde estoy?",
    "GeolocateControl.LocationNotAvailable": "Tu posición no está disponible",
    "ScaleControl.Meters": "m",
    "ScaleControl.Kilometers": "km",
  },
  en: {
    "Map.Title": "Map of Roldanillo",
    "NavigationControl.ZoomIn": "Zoom in",
    "NavigationControl.ZoomOut": "Zoom out",
    "NavigationControl.ResetBearing": "Drag to rotate map, click to reset north",
    "AttributionControl.ToggleAttribution": "Toggle attribution",
    "GeolocateControl.FindMyLocation": "Where am I?",
    "GeolocateControl.LocationNotAvailable": "Location not available",
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

// Estado de la ruta. La posición solo vive aquí, en el navegador: no se envía a
// ningún lado. window.veniRuta lo expone para las pruebas de render.
const ruta = {
  posicion: null, // [lon, lat] del último "¿Dónde estoy?"
  destino: null, // [lon, lat] del último punto tocado
  perfil: "foot",
  estado: "sin-posicion", // sin-posicion | pedir-posicion | listo | calculando | ruta | sin-ruta | fuera | error | sin-permiso
  ultima: null, // la ruta del router: distance (m), duration (s), coordinates, snap
};

const urlEstilo = () => new URL(`style/veni-${estado.tema}-${estado.idioma}.json`, location.href).href;

function aplicarTextos() {
  const textos = TEXTOS[estado.idioma];
  document.documentElement.lang = estado.idioma;
  document.title = textos.titulo;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = textos[el.dataset.i18n];
  mostrarRuta();
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
  etiquetar(".maplibregl-ctrl-geolocate", t["GeolocateControl.FindMyLocation"]);
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

// --- Posición y ruta -------------------------------------------------------------

const COLOR_RUTA = "#F0525A"; // arrebol, solo en formas

function formatoDistancia(metros) {
  if (metros < 1000) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  const km = (metros / 1000).toFixed(1);
  return `${estado.idioma === "es" ? km.replace(".", ",") : km} km`;
}

// Se llama también desde aplicarTextos(), antes de que exista el mapa.
function mostrarRuta() {
  const t = TEXTOS[estado.idioma].ruta;
  const panelEstado = document.getElementById("ruta-estado");
  for (const boton of document.querySelectorAll("[data-perfil]")) {
    boton.setAttribute("aria-pressed", String(boton.dataset.perfil === ruta.perfil));
  }
  if (ruta.estado === "ruta" && ruta.ultima) {
    const minutos = Math.max(1, Math.round(ruta.ultima.duration / 60));
    panelEstado.textContent = `${formatoDistancia(ruta.ultima.distance)} · ${minutos} min ${t[ruta.perfil]}`;
  } else {
    panelEstado.textContent = t[ruta.estado];
  }
}

// El grafo (~215 KB con gzip) y el router se bajan al pedir la primera ruta, no
// al abrir el mapa. Si falla, se olvida la promesa para reintentar.
let router = null;
function cargarRouter() {
  router ??= (async () => {
    const [{ Router }, build] = await Promise.all([
      import("./vendor/rutas/router.js"),
      fetch("build.json").then((res) => (res.ok ? res.json() : Promise.reject(new Error(`build.json: HTTP ${res.status}`)))),
    ]);
    const res = await fetch(`${build.region}-rutas.json`);
    if (!res.ok) throw new Error(`rutas: HTTP ${res.status}`);
    return new Router(await res.json());
  })().catch((error) => {
    router = null;
    throw error;
  });
  return router;
}

const vacio = { type: "FeatureCollection", features: [] };

// Capas de la ruta: se vuelven a agregar después de cada cambio de estilo
// (setStyle con diff: false borra las fuentes y capas propias).
function dibujarRuta() {
  if (!mapa.getSource("ruta")) {
    mapa.addSource("ruta", { type: "geojson", data: vacio });
    mapa.addSource("ruta-ajuste", { type: "geojson", data: vacio });
    const oscuro = estado.tema === "oscuro";
    mapa.addLayer({ id: "ruta-borde", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": oscuro ? "#1C0F26" : "#FFFFFF", "line-width": 9 } });
    mapa.addLayer({ id: "ruta", type: "line", source: "ruta", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": COLOR_RUTA, "line-width": 5 } });
    // Del punto pedido a la red: el tramo que el router no recorre.
    mapa.addLayer({ id: "ruta-ajuste", type: "line", source: "ruta-ajuste", paint: { "line-color": COLOR_RUTA, "line-width": 3, "line-dasharray": [1, 1.5] } });
  }
  const r = ruta.estado === "ruta" ? ruta.ultima : null;
  mapa.getSource("ruta").setData(r ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.coordinates } } : vacio);
  mapa.getSource("ruta-ajuste").setData(
    r
      ? {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiLineString", coordinates: [[ruta.posicion, r.coordinates[0]], [r.coordinates.at(-1), ruta.destino]] },
        }
      : vacio,
  );
}

const marcadorDestino = new maplibregl.Marker({ color: COLOR_RUTA });

async function calcularRuta() {
  if (!ruta.posicion || !ruta.destino) return;
  ruta.estado = "calculando";
  mostrarRuta();
  try {
    const calculada = (await cargarRouter()).route(ruta.posicion, ruta.destino, ruta.perfil);
    ruta.ultima = calculada;
    ruta.estado = calculada ? "ruta" : "sin-ruta";
  } catch (error) {
    console.warn(error);
    ruta.ultima = null;
    ruta.estado = "error";
  }
  mostrarRuta();
  dibujarRuta();
}

const ubicacion = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  fitBoundsOptions: { maxZoom: 16 },
});
mapa.addControl(ubicacion, "top-right");
ubicacion.on("geolocate", (evento) => {
  ruta.posicion = [evento.coords.longitude, evento.coords.latitude];
  if (ruta.destino && ruta.estado !== "fuera") calcularRuta();
  else {
    ruta.estado = "listo";
    mostrarRuta();
  }
});
// Fuera de maxBounds MapLibre no dibuja la posición: no hay ruta posible.
ubicacion.on("outofmaxbounds", () => {
  ruta.posicion = null;
  ruta.ultima = null;
  ruta.estado = "fuera";
  mostrarRuta();
  dibujarRuta();
});
ubicacion.on("error", () => {
  ruta.estado = "sin-permiso";
  mostrarRuta();
});

mapa.on("click", (evento) => {
  if (ruta.estado === "fuera") return;
  ruta.destino = [evento.lngLat.lng, evento.lngLat.lat];
  marcadorDestino.setLngLat(ruta.destino).addTo(mapa);
  if (!ruta.posicion) {
    ruta.estado = "pedir-posicion";
    mostrarRuta();
    return;
  }
  calcularRuta();
});

for (const boton of document.querySelectorAll("[data-perfil]")) {
  boton.addEventListener("click", () => {
    if (ruta.perfil === boton.dataset.perfil) return;
    ruta.perfil = boton.dataset.perfil;
    mostrarRuta();
    calcularRuta();
  });
}

mapa.on("style.load", dibujarRuta);
mostrarRuta();

// Para las pruebas de render (issue #6) y para depurar desde la consola.
window.veniMapa = mapa;
window.veniRuta = ruta;
