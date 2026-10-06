const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  fs.mkdirSync("output", { recursive: true });

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: {
      width: 1366,
      height: 768,
    },
  });

  const url =
    "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

  console.log("Abriendo Talento Perú...");
  console.log(url);

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("STATUS:", response?.status());

    const title = await page.title();

    console.log("TITLE:", title);

    const text = await page.locator("body").innerText();

    console.log("-------------------------");
    console.log("CONTENIDO INICIAL");
    console.log("-------------------------");

    console.log(text.substring(0, 3000));

    await page.screenshot({
      path: "output/talento-peru.png",
      fullPage: true,
    });

    console.log("Screenshot generado correctamente.");
  } catch (error) {
    console.error("ERROR:");
    console.error(error);

    await page.screenshot({
      path: "output/error.png",
      fullPage: true,
    });

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
