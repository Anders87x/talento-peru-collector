const fs = require("fs");
const path = require("path");

const INPUT = path.join("docs", "results", "today-jobs.json");
const OUTPUT = path.join("docs", "results", "laravel-payload.json");
const SOURCE_URL =
  "https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml";

function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function buildPayload(result) {
  const jobs = (result.jobs || [])
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
      source_url: SOURCE_URL,
    }));

  return {
    schema_version: 1,
    source: "talento_peru",
    collected_at: result.captured_at || new Date().toISOString(),
    publication_date: toIsoDate(result.target_date),
    discovered_count: Number(result.total_today || 0),
    ready_count: jobs.length,
    jobs,
  };
}

if (!fs.existsSync(INPUT)) {
  console.error(`No existe ${INPUT}. Ejecuta primero npm run collect:today`);
  process.exit(1);
}

const result = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const payload = buildPayload(result);

fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2), "utf8");

console.log("Payload Laravel generado:");
console.log(OUTPUT);
console.log("");
console.log("Descubiertas:", payload.discovered_count);
console.log("Listas para importar:", payload.ready_count);
