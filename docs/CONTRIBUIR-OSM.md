# Mejorar el mapa de Roldanillo en OpenStreetMap

Todo lo que muestra el mapa de Vení sale de [OpenStreetMap](https://www.openstreetmap.org/) (OSM): calles, nombres, negocios, parques. Este repositorio no guarda ni corrige datos, solo los recorta y les da estilo. Si algo falta o está mal, la forma de arreglarlo es editar OSM: el cambio llega a este mapa y a cualquier otro que use OSM.

## Qué mapear

Lo que más le sirve a la app, en orden:

| Qué | Etiquetas principales | Por qué importa |
| --- | --- | --- |
| Restaurantes, cafés, comidas rápidas, panaderías | `amenity=restaurant`, `amenity=cafe`, `amenity=fast_food`, `shop=bakery`, con `name` | Son el centro de la app. |
| Horarios | `opening_hours` (por ejemplo `Mo-Sa 08:00-20:00; Su 09:00-14:00`) | Saber si está abierto antes de ir. Se puede validar en la [herramienta de opening_hours](https://openingh.openstreetmap.de/evaluation_tool/). |
| Tipo de cocina y contacto | `cuisine` (`regional`, `pizza`, `burger`…), `phone`, `website` | Filtrar y llamar. |
| Calles | `highway=*` con `name` | Que las rutas y las direcciones tengan sentido. |
| Lugares de referencia | Parques, iglesias, el Museo Rayo, la plaza, las veredas (`place=*`) | Orientarse por lo que la gente conoce. |

### Nombres en inglés (`name:en`)

El estilo en inglés muestra `name:en` y, si no existe, el nombre local (`name`). Solo agregá `name:en` cuando el lugar **tiene de verdad** un nombre en inglés en uso, como pasa con países o accidentes geográficos grandes (el mar Caribe es `Caribbean Sea`). En Roldanillo casi nunca hace falta. No traduzcas nombres propios: "Restaurante La Fonda" no se convierte en "The Inn Restaurant", y "Calle 7" no pasa a ser "7th Street". Inventar traducciones va contra las reglas de OSM y, en el mapa, es peor que mostrar el nombre local.

## Con qué editar

| Editor | Dónde | Para qué |
| --- | --- | --- |
| [iD](https://www.openstreetmap.org/edit?editor=id#map=16/4.412/-76.155) | Navegador, en openstreetmap.org | Editar en el computador: dibujar, mover y etiquetar. Tiene un tutorial la primera vez. |
| [StreetComplete](https://streetcomplete.app/) | Android | Responder preguntas cortas en la calle ("¿qué horario tiene?", "¿cómo se llama esta calle?"). Es la forma más fácil de empezar. |
| [Every Door](https://every-door.app/) | Android e iOS | Recorrer una zona y agregar o actualizar negocios y horarios uno por uno. Ideal para inventariar restaurantes. |

Para editar se necesita una cuenta gratuita en [openstreetmap.org](https://www.openstreetmap.org/user/new).

## Reglas y buenas prácticas

- **No copies de Google Maps, TripAdvisor, Waze ni de otros mapas o sitios.** Sus datos tienen licencias incompatibles con OSM, y copiarlos obliga a borrar todo lo que se derivó de ellos. Valen lo que viste en persona, fotos propias y las imágenes satelitales que ofrece el editor (tienen permiso explícito para OSM).
- **Mapeá lo que existe en el terreno.** No agregues negocios cerrados, planes futuros ni datos "de memoria" que no estés seguro.
- **Escribí un comentario claro en cada conjunto de cambios**, por ejemplo "Horarios de restaurantes del parque principal de Roldanillo (verificados en persona)".
- **No edites para la app.** OSM describe el mundo, no a Vení: nada de etiquetas inventadas ni de publicidad en `name` ("La Fonda — ¡el mejor almuerzo!").
- **Si no sabés cómo etiquetar algo**, buscalo en la [wiki de OSM](https://wiki.openstreetmap.org/wiki/ES:P%C3%A1gina_principal) o preguntá en la [comunidad de OSM Colombia](https://community.openstreetmap.org/c/communities/co/).

Guías oficiales: [Cómo contribuir](https://wiki.openstreetmap.org/wiki/ES:C%C3%B3mo_contribuir) y [Derechos de autor y licencia](https://www.openstreetmap.org/copyright/es).

## Cuándo aparece el cambio en el mapa

1. **OpenStreetMap:** el cambio se ve en openstreetmap.org a los pocos minutos.
2. **Protomaps:** publica cada día una build del planeta a partir de OSM; el cambio entra en una de las siguientes builds.
3. **Este repositorio:** el día 3 de cada mes, la [actualización mensual](../README.md#actualización-mensual) recorta la build más reciente y abre un PR con la comparación. Al fusionarlo, release-please prepara el PR de una versión de parche, y al fusionar ese PR se publica la versión nueva del mapa.
4. **La app:** usa esa versión cuando se actualiza a la release nueva.

En total, entre unos días y algo más de un mes. Si hace falta antes, se puede lanzar la actualización a mano (*Actions → Actualizar extracto → Run workflow*).

Los restaurantes, cafés, comidas rápidas y bares llegan al archivo del mapa, pero el mapa base no los dibuja: los muestra la app con sus propios marcadores (ver [Estilos](../README.md#estilos)). Las calles, los parques y el resto de los lugares sí se ven en el mapa base.

El extracto llega hasta el zoom 15. Algunos elementos pequeños (por ejemplo, ciertos puntos de interés) solo aparecen al acercarse, según las reglas del estilo base de Protomaps.

## Atribución

Los datos del mapa son © colaboradores de OpenStreetMap, bajo la licencia [ODbL](https://opendatacommons.org/licenses/odbl/1-0/). Al contribuir, tus cambios quedan bajo esa misma licencia.
