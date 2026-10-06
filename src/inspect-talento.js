const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const URL =
  "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

const DEBUG_DIR = path.join("docs", "debug");

function saveJson(fileName, data) {
  fs.writeFileSync(
    path.join(DEBUG_DIR, fileName),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

(async () => {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const headless = process.env.HEADLESS !== "false";

  const browser = await chromium.launch({
    headless,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "es-PE",
    timezoneId: "America/Lima",
  });

  const page = await context.newPage();

  const network = [];
  const consoleMessages = [];

  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text(),
    });
  });

  page.on("response", async (response) => {
    const request = response.request();
    const resourceType = request.resourceType();

    if (!["document", "xhr", "fetch"].includes(resourceType)) {
      return;
    }

    network.push({
      method: request.method(),
      resourceType,
      status: response.status(),
      url: response.url(),
      contentType: response.headers()["content-type"] || null,
    });
  });

  console.log("Abriendo Talento Perú...");
  console.log(URL);

  let response = null;

  try {
    response = await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    const status = response?.status() ?? null;
    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");

    console.log("STATUS:", status);
    console.log("TITLE:", title);
    console.log("URL FINAL:", currentUrl);

    const metadata = await page.evaluate(() => {
      return {
        links: document.querySelectorAll("a").length,
        forms: document.querySelectorAll("form").length,
        inputs: document.querySelectorAll("input").length,
        selects: document.querySelectorAll("select").length,
        buttons: document.querySelectorAll("button").length,
        tables: document.querySelectorAll("table").length,
        rows: document.querySelectorAll("tr").length,
        iframes: document.querySelectorAll("iframe").length,
      };
    });

    saveJson("metadata.json", {
      capturedAt: new Date().toISOString(),
      status,
      title,
      currentUrl,
      ...metadata,
    });

    fs.writeFileSync(
      path.join(DEBUG_DIR, "body.txt"),
      bodyText,
      "utf8"
    );

    fs.writeFileSync(
      path.join(DEBUG_DIR, "page.html"),
      await page.content(),
      "utf8"
    );

    const links = await page.locator("a").evaluateAll((items) =>
      items.map((item) => ({
        text: (item.innerText || item.textContent || "").trim(),
        href: item.href || null,
        id: item.id || null,
        className: item.className || null,
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

    const tables = await page.locator("table").evaluateAll((items) =>
      items.map((table, index) => ({
        index,
        id: table.id || null,
        className: table.className || null,
        headers: Array.from(table.querySelectorAll("th")).map((th) =>
          (th.innerText || th.textContent || "").trim()
        ),
        rowCount: table.querySelectorAll("tr").length,
        sampleRows: Array.from(table.querySelectorAll("tr"))
          .slice(0, 8)
          .map((row) =>
            Array.from(row.querySelectorAll("th, td")).map((cell) =>
              (cell.innerText || cell.textContent || "").trim()
            )
          ),
      }))
    );
    saveJson("tables.json", tables);

    const controls = await page
      .locator("input, select, textarea, button")
      .evaluateAll((items) =>
        items.map((item) => ({
          tag: item.tagName.toLowerCase(),
          type: item.getAttribute("type"),
          id: item.id || null,
          name: item.getAttribute("name"),
          value:
            item.getAttribute("type") === "hidden"
              ? "[hidden]"
              : item.value || null,
          text:
            item.tagName.toLowerCase() === "button"
              ? (item.innerText || "").trim()
              : null,
        }))
      );
    saveJson("controls.json", controls);

    saveJson("network.json", network);
    saveJson("console.json", consoleMessages);

    await page.screenshot({
      path: path.join(DEBUG_DIR, "talento-peru.png"),
      fullPage: true,
    });

    console.log("");
    console.log("Diagnóstico generado en:");
    console.log(DEBUG_DIR);
    console.log("");
    console.log("Archivos:");
    console.log("- metadata.json");
    console.log("- body.txt");
    console.log("- page.html");
    console.log("- links.json");
    console.log("- forms.json");
    console.log("- tables.json");
    console.log("- controls.json");
    console.log("- network.json");
    console.log("- console.json");
    console.log("- talento-peru.png");
  } catch (error) {
    console.error("ERROR:", error);

    saveJson("error.json", {
      capturedAt: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    });

    await page
      .screenshot({
        path: path.join(DEBUG_DIR, "error.png"),
        fullPage: true,
      })
      .catch(() => {});

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
