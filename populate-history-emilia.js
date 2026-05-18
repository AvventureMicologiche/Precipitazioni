/**
 * populate-history-emilia.js
 * Genera file JSON storici per Emilia Romagna
 * - Ultimi 15 giorni: dati ARPA reali da apps.arpae.it
 * - Giorni precedenti: Open-Meteo Archive
 * Salta i file già esistenti (non sovrascrive dati reali)
 *
 * Uso: node populate-history-emilia.js
 * Prerequisiti: Node.js 18+
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Configurazione ─────────────────────────────────────────────
const DAYS_BACK  = 365;
const DELAY_MS   = 2000;
const RETRY_DELAY_MS = 60000;
const DATA_DIR   = path.join(__dirname, 'data', 'emilia');
const API_URL    = 'https://apps.arpae.it/REST/meteo_giornalieri?max_results=1000';

// Stazioni hardcoded per Open-Meteo Archive (usate solo per giorni > 15gg fa)
const OM_STATIONS = [
  {n:"Bologna",          lat:44.494,lon:11.343,q:54,  p:"BO"},
  {n:"Ferrara",          lat:44.836,lon:11.620,q:9,   p:"FE"},
  {n:"Modena",           lat:44.646,lon:10.926,q:34,  p:"MO"},
  {n:"Reggio Emilia",    lat:44.698,lon:10.631,q:58,  p:"RE"},
  {n:"Parma",            lat:44.801,lon:10.328,q:57,  p:"PR"},
  {n:"Piacenza",         lat:45.052,lon:9.693, q:61,  p:"PC"},
  {n:"Ravenna",          lat:44.418,lon:12.204,q:4,   p:"RA"},
  {n:"Rimini",           lat:44.059,lon:12.565,q:8,   p:"RN"},
  {n:"Forlì",            lat:44.222,lon:12.041,q:33,  p:"FC"},
  {n:"Cesena",           lat:44.133,lon:12.243,q:44,  p:"FC"},
  {n:"Imola",            lat:44.352,lon:11.714,q:47,  p:"BO"},
  {n:"Faenza",           lat:44.286,lon:11.883,q:35,  p:"RA"},
  {n:"Lugo",             lat:44.420,lon:11.904,q:14,  p:"RA"},
  {n:"Comacchio",        lat:44.695,lon:12.183,q:2,   p:"FE"},
  {n:"Fidenza",          lat:44.865,lon:10.063,q:75,  p:"PR"},
  {n:"Guastalla",        lat:44.921,lon:10.660,q:24,  p:"RE"},
  {n:"Carpi",            lat:44.782,lon:10.886,q:26,  p:"MO"},
  {n:"Sassuolo",         lat:44.547,lon:10.785,q:121, p:"MO"},
  {n:"Pavullo",          lat:44.337,lon:10.834,q:682, p:"MO"},
  {n:"Lago Scaffaiolo",  lat:44.175,lon:10.714,q:1773,p:"MO"},
  {n:"Porretta Terme",   lat:44.157,lon:11.026,q:348, p:"BO"},
  {n:"Castel S.Pietro",  lat:44.401,lon:11.583,q:75,  p:"BO"},
  {n:"Argenta",          lat:44.614,lon:11.833,q:2,   p:"FE"},
  {n:"Boretto",          lat:44.898,lon:10.554,q:25,  p:"RE"},
  {n:"Castelnovo Monti", lat:44.432,lon:10.410,q:724, p:"RE"},
  {n:"Fiumalbo",         lat:44.166,lon:10.637,q:953, p:"MO"},
  {n:"Riccione",         lat:44.003,lon:12.655,q:4,   p:"RN"},
  {n:"Cattolica",        lat:43.966,lon:12.730,q:4,   p:"RN"},
  {n:"Sasso Marconi",    lat:44.399,lon:11.253,q:124, p:"BO"},
  {n:"Vergato",          lat:44.281,lon:11.108,q:280, p:"BO"},
  {n:"Piacenza Po",      lat:45.060,lon:9.720, q:58,  p:"PC"},
  {n:"Ponte dell'Olio",  lat:44.870,lon:9.650, q:215, p:"PC"},
  {n:"Bedonia",          lat:44.510,lon:9.626, q:450, p:"PR"},
  {n:"Bore",             lat:44.757,lon:9.870, q:630, p:"PR"},
  {n:"Bardi",            lat:44.633,lon:9.722, q:790, p:"PR"},
  {n:"Langhirano",       lat:44.620,lon:10.266,q:265, p:"PR"},
  {n:"Sorbolo",          lat:44.850,lon:10.450,q:28,  p:"PR"},
  {n:"Bismantova",       lat:44.427,lon:10.417,q:1041,p:"RE"},
  {n:"Busana",           lat:44.367,lon:10.317,q:614, p:"RE"},
  {n:"Fanano",           lat:44.183,lon:10.817,q:650, p:"MO"},
  {n:"Lama Mocogno",     lat:44.267,lon:10.733,q:812, p:"MO"},
  {n:"Reno Centese",     lat:44.733,lon:11.317,q:8,   p:"FE"},
  {n:"Medicina",         lat:44.483,lon:11.633,q:17,  p:"BO"},
  {n:"Molinella",        lat:44.617,lon:11.667,q:7,   p:"BO"},
  {n:"Conselice",        lat:44.517,lon:11.833,q:4,   p:"RA"},
  {n:"Cervia",           lat:44.267,lon:12.350,q:2,   p:"RA"},
  {n:"Cesenatico",       lat:44.200,lon:12.383,q:2,   p:"FC"},
  {n:"Savignano",        lat:44.117,lon:12.383,q:10,  p:"FC"},
  {n:"Verghereto",       lat:43.783,lon:12.000,q:1023,p:"FC"},
  {n:"Bagno di Romagna", lat:43.833,lon:11.950,q:491, p:"FC"},
  {n:"Santarcangelo",    lat:44.067,lon:12.450,q:35,  p:"RN"}
];

// ── Utility ────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

async function fetchJSON(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', reject);
    });
    if (result.status === 200) return JSON.parse(result.data);
    if (result.status === 429) {
      console.warn(`\n  Rate limit (429), attendo 60s...`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`HTTP ${result.status}`);
  }
  throw new Error('Troppi tentativi falliti');
}

// ── Scarica dati ARPA per tutti i giorni disponibili ──────────
async function fetchARPAData() {
  console.log('Scarico dati ARPA (ultimi 15gg)...');
  const raw = await fetchJSON(API_URL);
  const items = raw._items || [];
  console.log(`  Stazioni ricevute: ${items.length}`);

  // Organizza per data
  const byDate = {};

  items.forEach(s => {
    try {
      const ana = s.anagrafica;
      if (!ana || !ana.geometry || !ana.geometry.coordinates) return;
      const lon = ana.geometry.coordinates[0];
      const lat = ana.geometry.coordinates[1];
      if (lat < 43.7 || lat > 45.2 || lon < 9.1 || lon > 12.8) return;
      if (!ana.variabili || !ana.variabili.includes('precipitazione_cumulata_giornaliera')) return;

      const dati = s.dati || {};
      Object.keys(dati).forEach(dateKey => {
        // dateKey = YYYYMMDD
        const dateStr = `${dateKey.substring(0,4)}-${dateKey.substring(4,6)}-${dateKey.substring(6,8)}`;
        const dayData = dati[dateKey];
        if (!dayData || !dayData['0000']) return;
        const val = parseFloat(dayData['0000'].precipitazione_cumulata_giornaliera);
        if (isNaN(val) || val < 0 || val >= 500) return;

        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push({
          id:  s._id,
          n:   ana.nome || '—',
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          q:   ana.altitudine || 0,
          p:   ana.provincia || '—',
          mm:  Math.round(val * 10) / 10
        });
      });
    } catch(e) {}
  });

  console.log(`  Date disponibili: ${Object.keys(byDate).length}`);
  return byDate;
}

// ── Fetch Open-Meteo Archive per un giorno ─────────────────────
async function fetchDayOM(stations, dateStr) {
  const lats = stations.map(s => s.lat).join(',');
  const lons = stations.map(s => s.lon).join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;

  const data = await fetchJSON(url);
  const arr = Array.isArray(data) ? data : [data];

  return arr.map((loc, i) => {
    const s = stations[i];
    if (!s) return null;
    const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
    return {
      id:  `om_${i}`,
      n:   s.n,
      lat: s.lat,
      lon: s.lon,
      q:   s.q,
      p:   s.p,
      mm:  mm > 300 ? 0 : Math.round((mm || 0) * 10) / 10
    };
  }).filter(Boolean);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n🍄 Pre-popolamento storico Emilia Romagna`);
  console.log(`   Periodo: ultimi ${DAYS_BACK} giorni`);
  console.log(`   ARPA reale per ultimi 15gg, Open-Meteo Archive per il resto\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Scarica dati ARPA reali
  const arpaByDate = await fetchARPAData();

  // Genera lista date
  const today = new Date();
  const dates = [];
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600000);
    dates.push(fmtDate(d));
  }

  let created = 0, skipped = 0, errors = 0;

  for (const dateStr of dates) {
    const outFile = path.join(DATA_DIR, `${dateStr}.json`);

    // Salta se file già esiste
    if (fs.existsSync(outFile)) {
      skipped++;
      continue;
    }

    try {
      let stations = [];
      let source = '';

      if (arpaByDate[dateStr] && arpaByDate[dateStr].length >= 10) {
        // Usa dati ARPA reali
        stations = arpaByDate[dateStr];
        source = 'arpa-emilia-arpae';
        process.stdout.write(`  ${dateStr} ✓ ARPA (${stations.length} stazioni)\r`);
      } else {
        // Usa Open-Meteo Archive
        const BATCH = 50;
        for (let i = 0; i < OM_STATIONS.length; i += BATCH) {
          const batch = OM_STATIONS.slice(i, i + BATCH);
          const results = await fetchDayOM(batch, dateStr);
          stations.push(...results);
          if (i + BATCH < OM_STATIONS.length) await sleep(200);
        }
        source = 'open-meteo-archive';
        process.stdout.write(`  ${dateStr} ✓ OM (${stations.length} stazioni)\r`);
        await sleep(DELAY_MS);
      }

      if (stations.length < 5) { errors++; continue; }

      fs.writeFileSync(outFile, JSON.stringify({
        date:      dateStr,
        collected: new Date().toISOString(),
        source,
        count:     stations.length,
        stations
      }));

      created++;

    } catch(e) {
      console.warn(`\n  ${dateStr} errore: ${e.message}`);
      errors++;
      await sleep(1000);
    }
  }

  console.log(`\n\n  Creati: ${created} | Saltati (già esistenti): ${skipped} | Errori: ${errors}`);
  console.log('\n✅ Completato! Carica data/emilia/ su GitHub.\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
