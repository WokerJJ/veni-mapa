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
      "posicion-lejos": "Sin ruta: tu posición está lejos de las calles de Roldanillo.",
      "sin-senal": "Sin señal de ubicación: esperando al GPS…",
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
      "posicion-lejos": "No route: your location is far from the streets of Roldanillo.",
      "sin-senal": "No location signal: waiting for GPS…",
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
    "Marker.Title": "Destino de la ruta",
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
    "Marker.Title": "Route destination",
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
  // sin-posicion | pedir-posicion | listo | calculando | ruta | sin-ruta |
  // posicion-lejos | fuera | error | sin-permiso | sin-senal
  estado: "sin-posicion",
  ultima: null, // la ruta del router: distance (m), duration (s), coordinates, snap
  calculadaDesde: null, // posición con la que se calculó la última ruta
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
  // Con el permiso denegado MapLibre deshabilita el botón: se dice por qué.
  const geolocalizar = mapa.getContainer().querySelector(".maplibregl-ctrl-geolocate");
  if (geolocalizar) etiquetar(".maplibregl-ctrl-geolocate", t[geolocalizar.disabled ? "GeolocateControl.LocationNotAvailable" : "GeolocateControl.FindMyLocation"]);
  mapa.getContainer().querySelector(".maplibregl-marker")?.setAttribute("aria-label", t["Marker.Title"]);
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

// Vista compartible en la URL (#vista=zoom/lat/lon). La escribe la demo y no
// MapLibre (opción hash): con «¿Dónde estoy?» la cámara sigue al usuario y el
// enlace delataría su posición, así que desde que se pide la ubicación y
// mientras haya una, la vista no se guarda.
const vistaInicial = (() => {
  const m = /^#vista=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(location.hash);
  return m ? { zoom: Number(m[1]), center: [Number(m[3]), Number(m[2])] } : null;
})();

const mapa = new maplibregl.Map({
  container: "mapa",
  style: estiloInicial,
  center: vistaInicial?.center ?? estiloInicial.center,
  zoom: vistaInicial?.zoom ?? estiloInicial.zoom,
  // El extracto guarda tiles enteros: en zooms bajos cubren medio continente.
  // Con maxBounds la cámara no sale de la región y no se ve el resto del mundo.
  maxBounds: Array.isArray(limites) && limites.length === 4 ? limites : undefined,
  attributionControl: { compact: false },
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
  cambiarEstilo();
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
  cambiarEstilo();
});

// --- Posición y ruta -------------------------------------------------------------

const COLOR_RUTA = "#F0525A"; // arrebol, solo en formas
// Metros que tiene que moverse la posición para recalcular (el GPS tiembla).
const MOVIMIENTO_MINIMO_M = 10;

function formatoDistancia(metros) {
  if (metros < 1000) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  const km = (metros / 1000).toFixed(1);
  return `${estado.idioma === "es" ? km.replace(".", ",") : km} km`;
}

function distanciaM([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Se llama también desde aplicarTextos(), antes de que exista el mapa.
function mostrarRuta() {
  const t = TEXTOS[estado.idioma].ruta;
  const panelEstado = document.getElementById("ruta-estado");
  for (const boton of document.querySelectorAll("[data-perfil]")) {
    boton.setAttribute("aria-pressed", String(boton.dataset.perfil === ruta.perfil));
  }
  const texto =
    ruta.estado === "ruta" && ruta.ultima
      ? `${formatoDistancia(ruta.ultima.distance)} · ${Math.max(1, Math.round(ruta.ultima.duration / 60))} min ${t[ruta.perfil]}`
      : t[ruta.estado];
  // role=status anuncia cada cambio: no se reescribe el mismo texto.
  if (panelEstado.textContent !== texto) panelEstado.textContent = texto;
}

// El grafo (~215 KB con gzip) y el router se bajan al pedir la primera ruta, no
// al abrir el mapa. Si falla, se olvida la promesa para reintentar.
let router = null;
let routerListo = null;
function cargarRouter() {
  router ??= (async () => {
    const [{ Router }, build] = await Promise.all([
      import("./vendor/rutas/router.js"),
      fetch("build.json").then((res) => (res.ok ? res.json() : Promise.reject(new Error(`build.json: HTTP ${res.status}`)))),
    ]);
    const res = await fetch(`${build.region}-rutas.json`);
    if (!res.ok) throw new Error(`rutas: HTTP ${res.status}`);
    routerListo = new Router(await res.json());
    return routerListo;
  })().catch((error) => {
    router = null;
    throw error;
  });
  return router;
}

const vacio = { type: "FeatureCollection", features: [] };

// Capas de la ruta: se vuelven a agregar después de cada cambio de estilo
// (setStyle con diff: false borra las fuentes y capas propias). Mientras el
// estilo nuevo carga, addSource lanzaría "Style is not done loading": no se
// toca nada y style.load dibuja el estado vigente. (isStyleLoaded() no sirve:
// también espera los tiles, y en style.load todavía es falso.)
let estiloListo = false;

function cambiarEstilo() {
  estiloListo = false;
  mapa.setStyle(urlEstilo(), { diff: false });
}

function dibujarRuta() {
  if (!estiloListo) return;
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
          geometry: { type: "MultiLineString", coordinates: [[r.desde, r.coordinates[0]], [r.coordinates.at(-1), r.hasta]] },
        }
      : vacio,
  );
}

let marcadorDestino = null;
function marcar(destino) {
  marcadorDestino ??= new maplibregl.Marker({ color: COLOR_RUTA });
  marcadorDestino.setLngLat(destino).addTo(mapa);
  marcadorDestino.getElement().setAttribute("aria-label", TEXTOS_MAPLIBRE[estado.idioma]["Marker.Title"]);
}

// Cada cálculo lleva un número: si mientras se baja el grafo llega otra
// posición, otro toque, otro perfil o la posición sale de la región, el
// resultado viejo se descarta en vez de pisar el estado nuevo.
let pedido = 0;

async function calcularRuta() {
  const id = ++pedido;
  const { posicion, destino, perfil } = ruta;
  if (!posicion || !destino) return;
  // Con el router ya cargado el cálculo es inmediato: sin "Calculando…".
  if (!routerListo) {
    ruta.estado = "calculando";
    mostrarRuta();
  }
  let calculada = null;
  let estadoNuevo;
  try {
    const r = await cargarRouter();
    calculada = r.route(posicion, destino, perfil);
    if (calculada) {
      calculada.desde = posicion;
      calculada.hasta = destino;
      estadoNuevo = "ruta";
    } else {
      // El router no dice cuál de los dos puntos quedó lejos de la red.
      estadoNuevo = r.nearest(posicion, perfil) < 0 ? "posicion-lejos" : "sin-ruta";
    }
  } catch (error) {
    console.warn(error);
    estadoNuevo = "error";
  }
  if (id !== pedido) return;
  ruta.ultima = calculada;
  ruta.estado = estadoNuevo;
  ruta.calculadaDesde = posicion;
  mostrarRuta();
  dibujarRuta();
}

function olvidarPosicion(estadoNuevo) {
  pedido++;
  ruta.posicion = null;
  ruta.ultima = null;
  ruta.calculadaDesde = null;
  ruta.estado = estadoNuevo;
  mostrarRuta();
  dibujarRuta();
}

let ubicando = false; // desde que se toca «¿Dónde estoy?» hasta apagarlo

const ubicacion = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  fitBoundsOptions: { maxZoom: 16 },
});
mapa.addControl(ubicacion, "top-right");

ubicacion.on("trackuserlocationstart", () => {
  ubicando = true;
});
// trackuserlocationend también llega al mover el mapa (el punto sigue, la
// cámara no). Solo al apagar el botón MapLibre le quita todas las clases de estado.
ubicacion.on("trackuserlocationend", () => {
  const boton = mapa.getContainer().querySelector(".maplibregl-ctrl-geolocate");
  const activo = [...(boton?.classList ?? [])].some((c) => /^maplibregl-ctrl-geolocate-(active|background|waiting)/.test(c));
  if (activo) return;
  ubicando = false;
  olvidarPosicion("sin-posicion");
});
ubicacion.on("geolocate", (evento) => {
  const posicion = [evento.coords.longitude, evento.coords.latitude];
  const anterior = ruta.calculadaDesde;
  ruta.posicion = posicion;
  if (!ruta.destino) {
    ruta.estado = "listo";
    mostrarRuta();
    return;
  }
  // Con destino: recalcular al volver a la región o si la posición se movió.
  if (ruta.estado === "ruta" && anterior && distanciaM(anterior, posicion) < MOVIMIENTO_MINIMO_M) return;
  calcularRuta();
});
// Fuera de maxBounds MapLibre no dibuja la posición: no hay ruta posible.
ubicacion.on("outofmaxbounds", () => olvidarPosicion("fuera"));
// Código 1: sin permiso. 2 y 3 (sin señal, tiempo agotado) son pasajeros y
// llegan seguido con la posición quieta (watchPosition agota su tiempo entre
// lecturas): con una posición ya conocida no cambian nada; sin ella, se avisa.
ubicacion.on("error", (evento) => {
  if (evento.code === 1) {
    ubicando = false;
    olvidarPosicion("sin-permiso");
  } else if (!ruta.posicion) {
    ruta.estado = "sin-senal";
    mostrarRuta();
  }
});

mapa.on("click", (evento) => {
  if (ruta.estado === "fuera") return;
  ruta.destino = [evento.lngLat.lng, evento.lngLat.lat];
  marcar(ruta.destino);
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

function guardarVista() {
  if (ubicando || ruta.posicion) return;
  const centro = mapa.getCenter();
  const url = new URL(location.href);
  url.hash = `vista=${mapa.getZoom().toFixed(2)}/${centro.lat.toFixed(4)}/${centro.lng.toFixed(4)}`;
  history.replaceState(null, "", url);
}

mapa.on("style.load", () => {
  estiloListo = true;
  dibujarRuta();
});
mapa.on("moveend", guardarVista);
mapa.once("load", guardarVista);
mostrarRuta();

// Para las pruebas de render (issue #6) y para depurar desde la consola.
window.veniMapa = mapa;
window.veniRuta = ruta;
