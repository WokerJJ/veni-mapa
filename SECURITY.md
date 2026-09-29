# Política de seguridad

## Versiones con soporte

Solo la última release publicada recibe correcciones.

## Cómo reportar una vulnerabilidad

No abras un issue público. Usá el reporte privado de GitHub: pestaña **Security → Report a vulnerability** de este repositorio. Incluí los pasos para reproducirla y el impacto que ves.

Respuesta inicial en un plazo de 7 días. Cuando haya corrección, se publica una release y un aviso de seguridad.

## Alcance

- Workflows de GitHub Actions y manejo de secrets (publicación en Cloudflare R2).
- Configuración de CORS del bucket de tiles.
- Dependencias del pipeline y de la demo.

Los errores en los datos del mapa no son vulnerabilidades: se corrigen en OpenStreetMap (ver `docs/CONTRIBUIR-OSM.md`).
