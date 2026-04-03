import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const WORKER_SECRET = process.env.WORKER_SECRET || '';

const DELAY_BETWEEN_MODELS_MS = [5000, 10000];
const PAGE_SIZE = 30;

const BASE_HEADERS = {
  'accept': 'application/json',
  'accept-language': 'es-ES',
  'content-type': 'application/json',
  'origin': 'https://www.coches.net',
  'referer': 'https://www.coches.net/',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'x-adevinta-channel': 'web-desktop',
  'x-adevinta-page-url': 'https://www.coches.net/',
  'x-adevinta-referer': 'https://www.coches.net/',
  'x-schibsted-tenant': 'coches',
};

function buildRequestBody(cn, page = 1) {
  return {
    pagination: { page, size: PAGE_SIZE },
    sort: { order: 'desc', term: 'relevance' },
    filters: {
      price: { from: null, to: null },
      bodyTypeIds: [],
      categories: { category1Ids: [2500] },
      drivenWheelsIds: [],
      entry: null,
      environmentalLabels: [],
      equipments: [],
      fuelTypeIds: [],
      hasPhoto: false,
      hasWarranty: false,
      hp: { from: null, to: null },
      isCertified: false,
      km: { from: null, to: null },
      luggageCapacity: { from: null, to: null },
      maxTerms: null,
      onlyPeninsula: false,
      offerTypeIds: [2],   // 2 = KM0
      provinceIds: [],
      searchText: '',
      sellerTypeId: 0,
      transmissionTypeId: null,
      vehicles: [{ makeId: cn.make_id, modelId: cn.model_id, model: '', version: '' }],
      year: { from: null, to: cn.year_to ?? null },
    },
  };
}

async function fetchPage(cn, page) {
  const res = await fetch('https://web.gw.coches.net/search/listing', {
    method: 'POST',
    headers: { ...BASE_HEADERS, 'x-adevinta-session-id': randomUUID() },
    body: JSON.stringify(buildRequestBody(cn, page)),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function scrapeModel(model) {
  console.log(`\n→ ${model.make} ${model.model} ${model.variant} (${model.id})`);
  const allListings = [];
  let page = 1;

  while (true) {
    const data = await fetchPage(model.coches_net, page);
    const items = data.items || [];
    const totalItems = data.pagination?.totalItems ?? items.length;

    if (page === 1) console.log(`  Total on coches.net: ${totalItems}`);

    const today = new Date().toISOString().split('T')[0];
    for (const item of items) {
      // Filter by variant keyword if set (e.g. "More")
      const filter = model.coches_net.filter || {};
      const include = filter.include || [];
      const exclude = filter.exclude || [];
      const titleLc = item.title.toLowerCase();
      if (include.length && !include.some(k => titleLc.includes(k.toLowerCase()))) continue;
      if (exclude.some(k => titleLc.includes(k.toLowerCase()))) continue;

      if (!item.price?.amount) continue;  // hoppa över annonser utan kontantpris

      const url = item.url.startsWith('http') ? item.url : `https://www.coches.net${item.url}`;
      const imageUrl = item.resources?.find(r => r.type === 'IMAGE')?.url ?? null;
      const versionKeywords = model.coches_net.version_keywords || [];
      const version = versionKeywords.find(k => item.title.toLowerCase().includes(k.toLowerCase())) ?? null;

      const versionFilter = model.coches_net.version_filter || [];
      if (versionFilter.length && (!version || !versionFilter.some(f => version.toLowerCase().startsWith(f.toLowerCase())))) continue;

      allListings.push({
        id: `coches_net:${item.id}`,
        model_id: model.id,
        source: 'coches_net',
        url,
        title: item.title,
        version,
        year: item.year ?? null,
        km: item.km ?? null,
        price: item.price?.amount ?? null,
        price_financed: item.price?.financedAmount ?? null,
        image_url: imageUrl,
        province: item.mainProvince ?? null,
        dealer_name: item.seller?.name ?? null,
        is_professional: item.seller?.isProfessional ? 1 : 0,
        first_seen: today,
        last_seen: today,
      });
    }

    const fetched = (page - 1) * PAGE_SIZE + items.length;
    if (fetched >= totalItems || items.length === 0) break;
    page++;
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`  Matched (variant filter): ${allListings.length}`);
  return allListings;
}

async function sendToWorker(listings) {
  if (DRY_RUN) {
    console.log('  [dry-run] Listings:');
    for (const l of listings) {
      console.log(`    ${l.title} | ${l.year ?? '?'} | ${l.km != null ? l.km.toLocaleString() + ' km' : '?'} | ${l.price != null ? l.price.toLocaleString() + ' €' : '?'} | ${l.province ?? ''} | ${l.dealer_name ?? ''}`);
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

async function main() {
  const config = yaml.load(fs.readFileSync(path.resolve(__dirname, '../config/models.yaml'), 'utf8'));
  console.log(`evkollen scraper — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Models: ${config.models.length}`);

  for (let i = 0; i < config.models.length; i++) {
    const model = config.models[i];
    const listings = await scrapeModel(model);
    if (listings.length > 0) await sendToWorker(listings);
    else console.log('  No matching listings.');

    if (i < config.models.length - 1) {
      const delay = Math.floor(Math.random() * (DELAY_BETWEEN_MODELS_MS[1] - DELAY_BETWEEN_MODELS_MS[0]) + DELAY_BETWEEN_MODELS_MS[0]);
      console.log(`  Waiting ${(delay / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
