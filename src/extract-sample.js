const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const URL =
  "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

const OUT_DIR = path.join("docs", "results");

function clean(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeField(label) {
  return clean(label)
    .replace(/:/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "es-PE",
    timezoneId: "America/Lima",
  });

  const page = await context.newPage();

  console.log("Abriendo Talento Perú...");

  try {
    const response = await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("STATUS:", response?.status());

    const result = await page.evaluate(() => {
      const clean = (value) =>
        String(value || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const normalizeField = (label) =>
        clean(label)
          .replace(/:/g, "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, "_");

      const bodyText = document.body.innerText || "";

      const pageMatch = bodyText.match(/Página\s+(\d+)\s+de\s+(\d+)/i);
      const totalMatch = bodyText.match(/([\d.,]+)\s+puesto\(s\)\s+encontrado\(s\)/i);

      const cards = Array.from(document.querySelectorAll(".cuadro-vacantes"))
        .slice(0, 10)
        .map((card, index) => {
          const fields = {};

          for (const label of card.querySelectorAll(".sub-titulo")) {
            const container = label.parentElement;
            const value = container?.querySelector(".detalle-sp");
            if (!value) continue;

            fields[normalizeField(label.textContent)] = clean(value.textContent);
          }

          const detailButton = card.querySelector(
            'button[title="¡Ver más!"], button[title*="Ver más"]'
          );
          const wordButton = card.querySelector(
            'button[title="Convocatoria en Word"]'
          );

          return {
            index,
            title: clean(
              card.querySelector(".titulo-vacante label")?.textContent
            ),
            entity: clean(
              card.querySelector(".nombre-entidad .detalle-sp")?.textContent
            ),
            location: fields.ubicacion || null,
            convocatoria: fields.numero_de_convocatoria || null,
            vacancies: fields.cantidad_de_vacantes
              ? Number(fields.cantidad_de_vacantes.replace(/[^0-9]/g, ""))
              : null,
            salary_text: fields.remuneracion || null,
            publication_start: fields.fecha_inicio_de_publicacion || null,
            publication_end: fields.fecha_fin_de_publicacion || null,
            detail_button_id: detailButton?.id || null,
            word_button_id: wordButton?.id || null,
            raw_fields: fields,
          };
        });

      return {
        captured_at: new Date().toISOString(),
        source: "talento_peru",
        url: location.href,
        current_page: pageMatch ? Number(pageMatch[1]) : null,
        total_pages: pageMatch ? Number(pageMatch[2]) : null,
        total_jobs: totalMatch
          ? Number(totalMatch[1].replace(/[.,]/g, ""))
          : null,
        jobs: cards,
      };
    });

    const file = path.join(OUT_DIR, "list-sample.json");
    fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");

    await page.screenshot({
      path: path.join(OUT_DIR, "list-sample.png"),
      fullPage: true,
    });

    console.log("");
    console.log("Resumen:");
    console.log("Página:", result.current_page, "de", result.total_pages);
    console.log("Puestos encontrados:", result.total_jobs);
    console.log("Muestra extraída:", result.jobs.length);
    console.log("");

    for (const job of result.jobs) {
      console.log(
        `[${job.index}] ${job.title} | ${job.entity} | ${job.salary_text}`
      );
    }

    console.log("");
    console.log("Resultado:");
    console.log(file);
  } catch (error) {
    console.error("ERROR:", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
