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

function normalizeLabel(value) {
  return clean(value)
    .replace(/:/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

function parseDate(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return new Date(`${year}-${month}-${day}T00:00:00-05:00`);
}

function limaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.day}/${map.month}/${map.year}`;
}

function getArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function parseSalary(value) {
  const normalized = clean(value)
    .replace(/S\/?\.?/gi, "")
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");

  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function toIsoDate(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function getDepartment(location) {
  const value = clean(location);
  if (!value) return null;

  const [department] = value.split(" - ");
  return clean(department) || null;
}

function buildLaravelPayload(result) {
  const jobs = result.jobs
    .filter((job) => job.detail?.external_id)
    .map((job) => ({
      source: "talento_peru",
      external_id: String(job.detail.external_id),
      title: clean(job.title),
      entity: clean(job.entity),
      location: clean(job.location),
      department: getDepartment(job.location),
      convocatoria: clean(job.convocatoria),
      vacancies: Number.isFinite(job.vacancies) ? job.vacancies : null,
      salary: Number.isFinite(job.salary) ? job.salary : null,
      salary_currency: "PEN",
      publication_start: toIsoDate(job.publication_start),
      publication_end: toIsoDate(job.publication_end),
      experience: clean(job.detail.experience) || null,
      academic_profile: clean(job.detail.academic_profile) || null,
      specialization: clean(job.detail.specialization) || null,
      knowledge: clean(job.detail.knowledge) || null,
      competencies: clean(job.detail.competencies) || null,
      application_url: job.detail.application_url || null,
      application_instructions: clean(job.detail.application_text) || null,
      source_url: URL,
    }));

  return {
    schema_version: 1,
    source: "talento_peru",
    collected_at: result.captured_at,
    publication_date: toIsoDate(result.target_date),
    discovered_count: result.total_today,
    ready_count: jobs.length,
    jobs,
  };
}

function uniqueKey(job) {
  return [
    job.entity,
    job.title,
    job.convocatoria,
    job.location,
    job.publication_start,
  ]
    .map((value) => clean(value).toLowerCase())
    .join("|");
}

async function currentPageNumber(page) {
  const text = await page
    .locator(".btn-paginator-cnt")
    .first()
    .innerText()
    .catch(() => "");

  const match = text.match(/Página\s+(\d+)\s+de\s+(\d+)/i);

  return {
    current: match ? Number(match[1]) : null,
    total: match ? Number(match[2]) : null,
  };
}

async function extractCards(page) {
  return page.locator(".cuadro-vacantes").evaluateAll((cards) => {
    const clean = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normalizeLabel = (value) =>
      clean(value)
        .replace(/:/g, "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");

    return cards.map((card, index) => {
      const fields = {};

      for (const label of card.querySelectorAll(".sub-titulo")) {
        const container = label.parentElement;
        const value = container?.querySelector(".detalle-sp");

        if (!value) continue;
        fields[normalizeLabel(label.textContent)] = clean(value.textContent);
      }

      const detailButton = card.querySelector(
        'button[title="¡Ver más!"], button[title*="Ver más"]'
      );

      return {
        index,
        title: clean(card.querySelector(".titulo-vacante label")?.textContent),
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
      };
    });
  });
}

async function clickNext(page, expectedCurrentPage) {
  const next = page.getByRole("button", { name: "Sig.", exact: true }).first();

  if (!(await next.isEnabled().catch(() => false))) {
    return false;
  }

  await next.click();

  await page.waitForFunction(
    (previous) => {
      const label = document.querySelector(".btn-paginator-cnt");
      if (!label) return false;

      const match = (label.textContent || "").match(/Página\s+(\d+)\s+de/i);
      return match && Number(match[1]) > previous;
    },
    expectedCurrentPage,
    { timeout: 30000 }
  );

  await page.waitForTimeout(800);
  return true;
}

async function ensureListPage(page, targetPage) {
  if (!page.url().includes("ofertas_laborales.xhtml")) {
    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);
  }

  let info = await currentPageNumber(page);

  if (info.current === targetPage) {
    return;
  }

  if (info.current && info.current > targetPage) {
    console.log(
      `Reiniciando listado: página actual ${info.current}, objetivo ${targetPage}`
    );

    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1800);
  }

  info = await currentPageNumber(page);

  while (info.current && info.current < targetPage) {
    const moved = await clickNext(page, info.current);
    if (!moved) {
      throw new Error(
        `No se pudo avanzar desde la página ${info.current} a ${targetPage}`
      );
    }
    info = await currentPageNumber(page);
  }

  if (info.current !== targetPage) {
    throw new Error(
      `No se pudo posicionar en la página ${targetPage}. Actual: ${info.current}`
    );
  }
}

async function extractDetail(page) {
  return page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const normalizeLabel = (value) =>
      clean(value)
        .replace(/:/g, "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");

    const requirements = {};

    for (const item of document.querySelectorAll(
      "#idDatosConvocatoria li"
    )) {
      const label = item.querySelector(".sub-titulo-2");
      const value = item.querySelector(".detalle-sp");

      if (!label || !value) continue;

      requirements[normalizeLabel(label.textContent)] = clean(
        value.textContent
      );
    }

    let applicationUrl = null;
    let applicationText = null;

    for (const label of document.querySelectorAll(
      "#idDatosConvocatoria .sub-titulo"
    )) {
      if (!clean(label.textContent).toUpperCase().startsWith("DETALLE")) {
        continue;
      }

      const container = label.parentElement;
      const detail = container?.querySelector(".detalle-sp");
      const link = detail?.querySelector("a");

      applicationUrl = link?.href || null;
      applicationText = clean(detail?.textContent);
      break;
    }

    const referenceText = clean(
      document.querySelector(".cuadro-seccion-lat .sub-titulo-2")?.textContent
    );
    const referenceMatch = referenceText.match(/(\d{4,})/);

    const findRequirement = (...parts) => {
      const entry = Object.entries(requirements).find(([key]) =>
        parts.every((part) => key.includes(part))
      );

      return entry ? entry[1] : null;
    };

    return {
      external_id: referenceMatch ? referenceMatch[1] : null,
      title: clean(document.querySelector(".sp-aviso0")?.textContent),
      entity: clean(document.querySelector(".sp-aviso")?.textContent),
      experience: findRequirement("experiencia"),
      academic_profile: findRequirement("formacion", "academica"),
      specialization: findRequirement("especializacion"),
      knowledge: findRequirement("conocimiento"),
      competencies: findRequirement("competencias"),
      application_url: applicationUrl,
      application_text: applicationText,
      source_detail_url: location.href,
      raw_requirements: requirements,
    };
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const targetDate = getArg("date") || limaToday();
  const detailLimit = Number(getArg("limit") || 10);
  const maxPages = Number(getArg("max-pages") || 10);

  if (!parseDate(targetDate)) {
    throw new Error(
      `Fecha inválida: ${targetDate}. Usa --date=DD/MM/YYYY`
    );
  }

  console.log("Fecha objetivo:", targetDate);
  console.log("Límite de detalles:", detailLimit);
  console.log("Máximo de páginas de seguridad:", maxPages);

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "false",
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "es-PE",
    timezoneId: "America/Lima",
  });

  const page = await context.newPage();

  const result = {
    captured_at: new Date().toISOString(),
    source: "talento_peru",
    target_date: targetDate,
    discovered_pages: [],
    total_today: 0,
    jobs: [],
  };

  try {
    const response = await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(2500);

    console.log("STATUS:", response?.status());

    const seen = new Set();
    let shouldStop = false;

    for (let safety = 0; safety < maxPages && !shouldStop; safety++) {
      const pageInfo = await currentPageNumber(page);
      const cards = await extractCards(page);

      if (!pageInfo.current) {
        throw new Error("No se pudo detectar la página actual.");
      }

      const todayCards = cards.filter(
        (job) => job.publication_start === targetDate
      );

      result.discovered_pages.push({
        page: pageInfo.current,
        total_pages: pageInfo.total,
        total_cards: cards.length,
        matching_date: todayCards.length,
        dates: [...new Set(cards.map((job) => job.publication_start))],
      });

      console.log(
        `Página ${pageInfo.current}: ${todayCards.length} de ${cards.length} son del ${targetDate}`
      );

      for (const job of todayCards) {
        const key = uniqueKey(job);
        if (seen.has(key)) continue;

        seen.add(key);

        result.jobs.push({
          ...job,
          source_page: pageInfo.current,
          salary: parseSalary(job.salary_text),
          detail: null,
        });
      }

      const target = parseDate(targetDate);
      const parsedDates = cards
        .map((job) => parseDate(job.publication_start))
        .filter(Boolean);

      const allOlder =
        parsedDates.length > 0 &&
        parsedDates.every((date) => date.getTime() < target.getTime());

      const containsOlder = parsedDates.some(
        (date) => date.getTime() < target.getTime()
      );

      if (allOlder || (todayCards.length > 0 && containsOlder)) {
        shouldStop = true;
        break;
      }

      const moved = await clickNext(page, pageInfo.current);
      if (!moved) {
        break;
      }
    }

    result.total_today = result.jobs.length;

    const outputFile = path.join(OUT_DIR, "today-jobs.json");

    // Guardamos primero el listado descubierto. Así no se pierde el
    // resultado aunque ocurra un error mientras se visitan los detalles.
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");

    console.log("");
    console.log("Ofertas encontradas para la fecha:", result.total_today);
    console.log("");

    const detailJobs = result.jobs.slice(0, detailLimit);

    // La exploración puede terminar en una página avanzada. Para los detalles
    // usamos una sesión nueva, que siempre parte del listado inicial.
    const detailContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "es-PE",
      timezoneId: "America/Lima",
    });

    const detailPage = await detailContext.newPage();

    const detailResponse = await detailPage.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await detailPage.waitForTimeout(1800);

    console.log("STATUS DETALLES:", detailResponse?.status());

    for (let i = 0; i < detailJobs.length; i++) {
      const job = detailJobs[i];

      console.log(
        `Detalle ${i + 1}/${detailJobs.length}: ${job.title}`
      );

      await ensureListPage(detailPage, job.source_page);

      const card = detailPage.locator(".cuadro-vacantes").nth(job.index);
      const button = card.locator(
        'button[title="¡Ver más!"], button[title*="Ver más"]'
      );

      await Promise.all([
        detailPage
          .waitForURL(/detalle_ofertas_laborales\.xhtml/, {
            timeout: 30000,
          })
          .catch(() => {}),
        button.click(),
      ]);

      await detailPage.waitForTimeout(1200);

      const detail = await extractDetail(detailPage);
      job.detail = detail;

      const back = detailPage.getByRole("button", {
        name: "Volver a la lista",
        exact: true,
      });

      if (await back.isVisible().catch(() => false)) {
        await back.click();
        await detailPage.waitForURL(/ofertas_laborales\.xhtml/, {
          timeout: 30000,
        }).catch(() => {});
        await detailPage.waitForTimeout(1200);
      } else {
        await detailPage.goto(URL, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await detailPage.waitForTimeout(1200);
      }

      // Persistimos el progreso después de cada detalle.
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
    }

    await detailContext.close();

    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");

    const laravelPayload = buildLaravelPayload(result);
    const laravelFile = path.join(OUT_DIR, "laravel-payload.json");

    fs.writeFileSync(
      laravelFile,
      JSON.stringify(laravelPayload, null, 2),
      "utf8"
    );

    const errorFile = path.join(OUT_DIR, "today-error.json");
    if (fs.existsSync(errorFile)) {
      fs.unlinkSync(errorFile);
    }

    console.log("");
    console.log("Resultados generados:");
    console.log("- Debug:", outputFile);
    console.log("- Laravel:", laravelFile);
    console.log("");
    console.log(
      `Se encontraron ${result.total_today} ofertas del ${targetDate}, se extrajeron ${detailJobs.length} detalles y ${laravelPayload.ready_count} quedaron listas para Laravel.`
    );
  } catch (error) {
    console.error("ERROR:", error);

    fs.writeFileSync(
      path.join(OUT_DIR, "today-error.json"),
      JSON.stringify(
        {
          captured_at: new Date().toISOString(),
          target_date: targetDate,
          message: error.message,
          stack: error.stack,
        },
        null,
        2
      ),
      "utf8"
    );

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
