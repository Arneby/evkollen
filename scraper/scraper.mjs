import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_SOURCE = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const DELAY_BETWEEN_MODELS_MS = [5000, 10000];

async function getSourceScraper(name) {
  const mod = await import(`./sources/${name}.mjs`);
  return mod.scrape;
}

async function sendToWorker(listings) {
  if (DRY_RUN) {
    for (const l of listings) {
      console.log(`    ${l.source} | ${l.title} | ${l.version ?? '–'} | ${l.year ?? '?'} | ${l.km != null ? l.km.toLocaleString() + ' km' : '?'} | ${l.price != null ? l.price.toLocaleString() + ' ' + l.currency : '?'} | ${l.dealer_name ?? ''}`);
    }
    return;
  }
  const res = await fetch(`${WORKER_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Secret': WORKER_SECRET },
    body: JSON.stringify({ listings }),
  });
  if (!res.ok) throw new Error(`Worker ${res.status}: ${await res.text()}`);
  const json = await res.json();
  console.log(`  Worker: ${json.inserted} inserted, ${json.updated} updated`);
}

async function fetchEurRates() {
  const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=SEK');
  if (!res.ok) throw new Error(`Frankfurter API ${res.status}`);
  const data = await res.json();
  return { SEK: data.rates.SEK, EUR: 1 };
}

async function main() {
  const config = yaml.load(fs.readFileSync(path.resolve(__dirname, '../config/models.yaml'), 'utf8'));
  console.log(`evkollen scraper — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (ONLY_SOURCE) console.log(`Source filter: ${ONLY_SOURCE}`);
  console.log(`Models: ${config.models.length}`);

  const rates = await fetchEurRates();
  console.log(`EUR/SEK: ${rates.SEK}\n`);

  for (let i = 0; i < config.models.length; i++) {
    const model = config.models[i];
    console.log(`→ ${model.make} ${model.model} ${model.variant ?? ''} (${model.id})`);

    const allListings = [];
    const sources = model.sources ?? {};

    for (const [sourceName, sourceConfig] of Object.entries(sources)) {
      if (ONLY_SOURCE && sourceName !== ONLY_SOURCE) continue;
      try {
        const scrape = await getSourceScraper(sourceName);
        const cfg = { ...sourceConfig, _year_from: model.year ?? null, _year_to: model.year ?? null };
        const listings = await scrape(model, cfg, rates);
        allListings.push(...listings);
      } catch (err) {
        console.error(`  [${sourceName}] Error: ${err.message}`);
      }
    }

    if (allListings.length > 0) {
      if (DRY_RUN) console.log(`  [dry-run] ${allListings.length} listings:`);
      await sendToWorker(allListings);
    } else {
      console.log('  No matching listings.');
    }

    if (i < config.models.length - 1) {
      const delay = Math.floor(Math.random() * (DELAY_BETWEEN_MODELS_MS[1] - DELAY_BETWEEN_MODELS_MS[0]) + DELAY_BETWEEN_MODELS_MS[0]);
      if (!DRY_RUN) {
        console.log(`  Waiting ${(delay / 1000).toFixed(1)}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
