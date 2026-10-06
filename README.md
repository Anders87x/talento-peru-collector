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
