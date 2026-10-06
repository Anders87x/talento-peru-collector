const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const URL =
  "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

const OUT_DIR = path.join("docs", "debug", "detail");

function saveJson(fileName, data) {
  fs.writeFileSync(
    path.join(OUT_DIR, fileName),
    JSON.stringify(data, null, 2),
    "utf8"
  );
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
    acceptDownloads: true,
  });

  const page = await context.newPage();
  const network = [];

  page.on("response", (response) => {
    const request = response.request();
    if (!["document", "xhr", "fetch"].includes(request.resourceType())) {
      return;
    }

    network.push({
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      url: response.url(),
      contentType: response.headers()["content-type"] || null,
    });
  });

  console.log("Abriendo listado...");

  try {
    const response = await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(3000);

    console.log("STATUS LISTADO:", response?.status());

    const firstCard = page.locator(".cuadro-vacantes").first();
    const firstTitle = (
      await firstCard.locator(".titulo-vacante label").innerText()
    ).trim();

    const firstEntity = (
      await firstCard.locator(".nombre-entidad .detalle-sp").innerText()
    ).trim();

    const detailButton = firstCard.locator(
      'button[title="¡Ver más!"], button[title*="Ver más"]'
    );

    const buttonId = await detailButton.getAttribute("id");

    console.log("Primera oferta:", firstTitle);
    console.log("Entidad:", firstEntity);
    console.log("Botón:", buttonId);
    console.log("Entrando al detalle...");

    const beforeUrl = page.url();

    await detailButton.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(
      () => {}
    );
    await page.waitForTimeout(4000);

    const afterUrl = page.url();
    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const html = await page.content();

    console.log("URL ANTES:", beforeUrl);
    console.log("URL DESPUÉS:", afterUrl);
    console.log("TITLE:", title);

    fs.writeFileSync(path.join(OUT_DIR, "body.txt"), bodyText, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, "page.html"), html, "utf8");

    const metadata = await page.evaluate(() => ({
      links: document.querySelectorAll("a").length,
      forms: document.querySelectorAll("form").length,
      inputs: document.querySelectorAll("input").length,
      selects: document.querySelectorAll("select").length,
      buttons: document.querySelectorAll("button").length,
      tables: document.querySelectorAll("table").length,
      iframes: document.querySelectorAll("iframe").length,
    }));

    saveJson("metadata.json", {
      capturedAt: new Date().toISOString(),
      firstTitle,
      firstEntity,
      buttonId,
      beforeUrl,
      afterUrl,
      title,
      ...metadata,
    });

    const links = await page.locator("a").evaluateAll((items) =>
      items.map((item) => ({
        text: (item.innerText || item.textContent || "").trim(),
        href: item.href || null,
        id: item.id || null,
        target: item.getAttribute("target"),
      }))
    );
    saveJson("links.json", links);

    const forms = await page.locator("form").evaluateAll((items) =>
      items.map((form) => ({
        id: form.id || null,
        name: form.getAttribute("name"),
        method: form.getAttribute("method"),
        action: form.getAttribute("action"),
        fields: Array.from(
          form.querySelectorAll("input, select, textarea, button")
        ).map((field) => ({
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type"),
          id: field.id || null,
          name: field.getAttribute("name"),
          placeholder: field.getAttribute("placeholder"),
          text:
            field.tagName.toLowerCase() === "button"
              ? (field.innerText || "").trim()
              : null,
        })),
      }))
    );
    saveJson("forms.json", forms);

    saveJson("network.json", network);

    await page.screenshot({
      path: path.join(OUT_DIR, "detail.png"),
      fullPage: true,
    });

    console.log("");
    console.log("Diagnóstico de detalle generado en:");
    console.log(OUT_DIR);
  } catch (error) {
    console.error("ERROR:", error);

    saveJson("error.json", {
      capturedAt: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    });

    await page
      .screenshot({
        path: path.join(OUT_DIR, "error.png"),
        fullPage: true,
      })
      .catch(() => {});

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
