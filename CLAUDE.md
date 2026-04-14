# evkollen

Prisspårare för begagnade elbilar och laddhybrider (BEV/PHEV) på europeiska bilmarknadsplatser.

## Arkitektur

```
scraper/ (Node.js ES modules)
  scraper.mjs          — orchestrator: laddar config, hämtar valutakurser, kör källor, skickar till worker
  sources/             — 5 källmoduler: autoscout, bytbil, coches_net, subito, wayke
worker/ (Cloudflare Workers + D1 SQLite)
  src/index.js         — API-endpoints + databas-logik
config/
  models.yaml          — 8 bilmodeller med källspecifik konfiguration
dashboard/ (Astro 6.1.3)
  src/pages/index.astro    — listningstabell + veckovisprisgraf (ApexCharts)
  src/pages/annons.astro   — detaljsida + prishistorik (Chart.js)
db/
  schema.sql           — D1-schema (models, listings, price_snapshots)
```

## Dataflöde

1. `scraper.mjs` kör varje källmodul → array av listings
2. Deduplicering mellan wayke/bytbil (samma år + km ±500 + matchande återförsäljare)
3. POST `/ingest` → worker lagrar i D1
4. Dashboard hämtar från worker-API och renderar

## Bilmodeller (config/models.yaml)

8 modeller: Lynk & Co 01/08 (PHEV), Land Rover Evoque/Discovery Sport P300e (PHEV), Citroën eC5 Aircross (BEV), BMW iX3 G08 (BEV), Peugeot e-3008 (BEV), VW ID.4 (BEV)

## Källmoduler

Varje modul exporterar `async scrape(model, sourceConfig, rates)` → listings[].

| Källa | Metod | Market |
|-------|-------|--------|
| wayke | JSON API | Sverige |
| bytbil | HTML-parsing (GTM dataLayer) | Sverige |
| coches_net | JSON API (POST) | Spanien (KM0) |
| subito | HTML-parsing (`__NEXT_DATA__`) | Italien |
| autoscout | HTML-parsing (`__NEXT_DATA__`) | Tyskland/EU |

## Worker API

| Endpoint | Method | Syfte |
|----------|--------|-------|
| `/ingest` | POST | Ta emot listings (kräver `X-Secret` header) |
| `/listings` | GET | Alla listings, ev. filtrerat `?model_id=X` |
| `/listing` | GET | Enskild listing `?id=X` |
| `/snapshots` | GET | Prishistorik `?listing_id=X` |
| `/price-history` | GET | Veckoaggregat `?model_id=X` |
| `/health` | GET | Hälsostatus |

## Kommandon

```bash
# Scraper
cd scraper && npm run scrape        # full körning
cd scraper && npm run scrape:dry    # dry-run, skriver ej till DB
npm run scrape -- --source=wayke    # kör bara en källa

# Dashboard
cd dashboard && npm run dev         # dev-server
cd dashboard && npm run build       # bygg till ./dist

# Worker
cd worker && wrangler dev           # lokal dev
cd worker && wrangler deploy        # driftsätt
```

## Miljövariabler

**Scraper:**
- `WORKER_URL` — default `http://localhost:8787`
- `WORKER_SECRET` — krävs i produktion

**Worker:**
- `.dev.vars`: `WORKER_SECRET=evkollen2026`
- D1-databas via `DB`-binding i `wrangler.toml`

## CI/CD

GitHub Actions (`.github/workflows/docker-scraper.yml`): bygger och pushar Docker-image till `ghcr.io/arneby/evkollen-scraper:latest` vid push till main (om scraper/, config/ eller Dockerfile.scraper ändrats).

Körs i produktion via docker-compose med `WORKER_URL` och `WORKER_SECRET` som env-variabler.

## Listning-schema

```
id              TEXT  "{source}:{external_id}"
model_id, source, url, title, version, year, km
price, price_financed, price_eur, currency
image_url, province, dealer_name, is_professional
first_seen, last_seen
```

Varje ingest skapar en rad i `price_snapshots` för prishistorik.
