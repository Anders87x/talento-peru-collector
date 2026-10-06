# Diagnóstico local de Talento Perú

Esta rama se usa para analizar la estructura real de Talento Perú desde una PC local, ya que los runners estándar de GitHub Actions reciben 403.

## Ejecutar diagnóstico

Desde la raíz del proyecto:

```bash
npm install
npx playwright install chromium
node src/inspect-talento.js
```

También puede ejecutarse con navegador visible:

```bash
set HEADLESS=false
node src/inspect-talento.js
```

En PowerShell:

```powershell
$env:HEADLESS="false"
node src/inspect-talento.js
```

## Archivos generados

El script guarda en `docs/debug/`:

- `metadata.json`: estado HTTP, título, URL final y conteo de elementos.
- `body.txt`: texto visible completo de la página.
- `page.html`: HTML final luego de cargar la página.
- `links.json`: enlaces encontrados.
- `forms.json`: formularios y nombres de controles, sin guardar valores ocultos.
- `tables.json`: tablas, cabeceras y muestras de filas.
- `controls.json`: inputs, selects, textareas y botones.
- `network.json`: requests de tipo document/xhr/fetch, sin cookies ni headers sensibles.
- `console.json`: mensajes de consola del navegador.
- `talento-peru.png`: captura completa de la página.

Si ocurre un error también se genera `error.json` y, cuando sea posible, `error.png`.

## Flujo para compartir una ejecución

Después de ejecutar el diagnóstico:

```bash
git add docs/debug
git commit -m "Add Talento Peru local debug capture"
git push origin feature/talento-extraction
```

Estos archivos se usarán únicamente para identificar selectores, formularios, tablas y posibles endpoints internos antes de construir el extractor definitivo.

> No subir cookies, contraseñas, tokens ni archivos de sesión.


## Siguiente fase: extraer una muestra real

Ya validado el acceso local, ejecuta:

```bash
git pull origin feature/talento-extraction
npm install
npm run extract:sample
```

Esto genera:

```text
docs/results/list-sample.json
docs/results/list-sample.png
```

El JSON contiene las primeras 10 convocatorias visibles con título, entidad, ubicación, número de convocatoria, vacantes, remuneración y fechas.

## Diagnóstico del detalle de una convocatoria

Después ejecuta:

```bash
npm run inspect:detail
```

El script abre la primera convocatoria y pulsa `¡Ver más!`. Luego guarda:

```text
docs/debug/detail/
├── metadata.json
├── body.txt
├── page.html
├── links.json
├── forms.json
├── network.json
└── detail.png
```

Sube los resultados a esta rama:

```bash
git add docs/results docs/debug/detail
git commit -m "Add Talento Peru extraction samples"
git push origin feature/talento-extraction
```

No subir cookies, tokens, contraseñas ni archivos de sesión.


## Recolectar únicamente las ofertas publicadas hoy

El recolector puede limitarse por la fecha de inicio de publicación de Talento Perú. Por defecto usa la fecha actual de Lima:

```bash
git pull origin feature/talento-extraction
npm run collect:today
```

Para pruebas, por seguridad solo abre el detalle de las primeras 10 ofertas encontradas. El listado sí recorre las páginas necesarias hasta detectar que las fechas ya son anteriores.

Resultado:

```text
docs/results/today-jobs.json
```

Puedes indicar una fecha manual:

```bash
npm run collect:today -- --date=06/10/2026
```

Puedes cambiar cuántos detalles abrir:

```bash
npm run collect:today -- --limit=20
```

Y combinar ambos:

```bash
npm run collect:today -- --date=06/10/2026 --limit=20
```

El JSON incluye la información del listado y, para los detalles procesados, experiencia, formación académica, especialización, conocimientos, competencias, URL de postulación y el identificador interno de Talento Perú.


### Límite de páginas

Por defecto el recolector revisa como máximo **10 páginas** del listado diario:

```bash
npm run collect:today
```

Si alguna vez quieres ampliar o reducir temporalmente ese límite:

```bash
npm run collect:today -- --max-pages=5
```

o:

```bash
npm run collect:today -- --max-pages=20
```

El filtro por fecha sigue activo; dentro de esas páginas solo se conservan las ofertas cuya fecha de inicio de publicación coincide con la fecha objetivo.


## Payload listo para Laravel

El recolector mantiene dos archivos diferentes:

```text
docs/results/today-jobs.json
```

Archivo de diagnóstico, con índices, páginas, botones y datos crudos del scraping.

```text
docs/results/laravel-payload.json
```

Payload limpio que usaremos más adelante para el endpoint de Laravel.

Cada ejecución exitosa de:

```bash
npm run collect:today
```

genera ambos archivos.

También puedes reconstruir el payload limpio sin volver a entrar a Talento Perú:

```bash
npm run payload:build
```

La estructura preparada para Laravel es:

```json
{
  "schema_version": 1,
  "source": "talento_peru",
  "collected_at": "2026-10-06T15:52:28.784Z",
  "publication_date": "2026-10-06",
  "discovered_count": 30,
  "ready_count": 30,
  "jobs": []
}
```

Cada empleo incluye `source + external_id`, combinación que usaremos para evitar duplicados en Laravel.
