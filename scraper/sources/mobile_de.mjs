const BASE_URL = 'https://suchen.mobile.de/fahrzeuge/search.html';

// Full browser-like headers required — mobile.de returns 403 without proper UA
const HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

function buildUrl(m, page) {
  // ms format: makeId;modelId;;description (empty fields are OK)
  const ms = [m.make_id, m.model_id ?? '', '', m.description ?? ''].join(';');
  const params = new URLSearchParams({
    dam:             '0',
    isSearchRequest: 'true',
    ms,
    ref:             'quickSearch',
    s:               'Car',
    vc:              'Car',
  });
  if (m.year_from != null || m.year_to != null) {
    params.set('fr', `${m.year_from ?? ''}:${m.year_to ?? ''}`);
  }
  // ft values: ELECTRIC, HYBRID, DIESEL, PETROL etc.
  if (m.fuel) params.set('ft', m.fuel);
  if (page > 1) params.set('pageNumber', page);
  return `${BASE_URL}?${params}`;
}

function normalizeTitle(s) {
  return s.replace(/R[\s-]?Dynamic/gi, 'R-Dynamic');
}

// Parse price from German format: "45.900 €" or "45 900 €"
function parsePrice(s) {
  if (!s) return null;
  const m = s.match(/([\d.\s]+)\s*€/);
  if (!m) return null;
  return parseInt(m[1].replace(/[\s.]/g, '')) || null;
}

// Parse km from German format: "15.000 km" or "15 000 km"
function parseKm(s) {
  if (!s) return null;
  const m = s.match(/([\d.\s]+)\s*km/i);
  if (!m) return null;
  return parseInt(m[1].replace(/[\s.]/g, '')) || null;
}

// Parse year from German first registration: "01/2025" or "2025"
function parseYear(s) {
  if (!s) return null;
  const m = s.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

// Extract listing cards from HTML search results page
function extractListings(html) {
  const listings = [];

  // Each listing is inside an <article> with class containing "cBox-body--resultitem"
  // or a <li> / <div> wrapper — try a wide match on data-ad-id attribute
  const adRe = /data-ad-id="(\d+)"([\s\S]*?)(?=data-ad-id="\d+"|<\/main|id="pagination)/g;
  let m;
  while ((m = adRe.exec(html)) !== null) {
    const id = m[1];
    const chunk = m[2];

    // URL: /fahrzeuge/details.html?id=...
    const urlM = chunk.match(/href="(\/fahrzeuge\/details\.html\?id=\d+[^"]*)"/);
    const url = urlM ? 'https://suchen.mobile.de' + urlM[1].replace(/&amp;/g, '&') : null;

    // Title from <h2> or span with "headline" class
    const titleM = chunk.match(/class="[^"]*(?:headline|result-item__title|g-col-4)[^"]*"[^>]*>\s*([^<\n]+)/);
    const title = titleM ? titleM[1].trim() : null;

    // Price: "45.900 €"
    const priceM = chunk.match(/([\d]{2,3}[\d.\s]+)\s*€/);
    const priceEur = priceM ? parseInt(priceM[1].replace(/[\s.]/g, '')) : null;

    // First registration: "01/2025" (EZ MM/YYYY)
    const regM = chunk.match(/(\d{1,2})\/(\d{4})/);
    const year = regM ? parseInt(regM[2]) : null;

    // Mileage: "15.000 km"
    const kmM = chunk.match(/([\d]{1,3}(?:[.\s]\d{3})*)\s*km/i);
    const km = kmM ? parseInt(kmM[1].replace(/[\s.]/g, '')) : null;

    // Dealer/seller name — look for data-seller-name or class with "seller"
    const dealerM = chunk.match(/data-seller-name="([^"]+)"|class="[^"]*seller-name[^"]*"[^>]*>([^<]+)/);
    const dealer = dealerM ? (dealerM[1] ?? dealerM[2] ?? '').trim() : null;

    // Image
    const imgM = chunk.match(/(?:src|data-src)="(https:\/\/[^"]+\.(?:jpg|jpeg|webp|png)[^"]*)"/i);
    const imageUrl = imgM ? imgM[1] : null;

    if (id) listings.push({ id, url, title, priceEur, year, km, dealer, imageUrl });
  }
  return listings;
}

function extractTotal(html) {
  // "1.234 Treffer" or "1.234 Angebote" or "1.234 Fahrzeuge"
  const m = html.match(/([\d.]+)\s+(?:Treffer|Angebote|Fahrzeuge)/i);
  return m ? parseInt(m[1].replace(/\./g, '')) : null;
}

async function fetchPage(m, page) {
  const url = buildUrl(m, page);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`mobile.de HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function scrape(model, m, rates) {
  const allListings = [];
  const year = model.year ?? null;
  let page = 1;

  while (true) {
    const html = await fetchPage(m, page);
    const items = extractListings(html);

    if (page === 1) {
      const total = extractTotal(html);
      console.log(`  [mobile.de] Total: ${total ?? `${items.length}+`}`);
    }

    if (items.length === 0) break;

    const today = new Date().toISOString().split('T')[0];
    const filter = m.filter || {};
    const include = filter.include || [];
    const exclude = filter.exclude || [];

    for (const item of items) {
      if (!item.title) continue;

      const normTitle = normalizeTitle(item.title);
      const titleLc = normTitle.toLowerCase();

      if (include.length && !include.some(k => titleLc.includes(k.toLowerCase()))) continue;
      if (exclude.some(k => titleLc.includes(k.toLowerCase()))) continue;

      // Year filter
      if (year && item.year !== year) continue;

      // Price sanity check (EUR — anything under 5000 is probably wrong)
      if (!item.priceEur || item.priceEur < 5000) continue;

      const versionKeywords = m.version_keywords || [];
      const version = versionKeywords.find(k => titleLc.includes(k.toLowerCase())) ?? null;

      const versionFilter = m.version_filter || [];
      if (versionFilter.length && (!version || !versionFilter.some(f => version.toLowerCase().startsWith(f.toLowerCase())))) continue;

      allListings.push({
        id:             `mobile_de:${item.id}`,
        model_id:       model.id,
        source:         'mobile_de',
        url:            item.url ?? `https://suchen.mobile.de/fahrzeuge/details.html?id=${item.id}`,
        title:          item.title,
        version,
        year:           item.year,
        km:             item.km,
        price:          item.priceEur,
        price_financed: null,
        price_eur:      item.priceEur,
        currency:       'EUR',
        image_url:      item.imageUrl ?? null,
        province:       null,
        dealer_name:    item.dealer ?? null,
        is_professional: 1,
        first_seen:     today,
        last_seen:      today,
      });
    }

    // Check if there's a next page
    const hasNext = html.includes('pageNumber=' + (page + 1)) ||
                    html.includes('class="btn btn--secondary-inverted pagination--btn-next"') ||
                    html.includes('"next"');
    if (!hasNext || items.length < 10) break;
    page++;
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`  [mobile.de] Matched: ${allListings.length}`);
  return allListings;
}
