/**
 * populate-history.js
 * Genera file JSON storici per Piemonte e Veneto usando Open-Meteo Archive
 * Salta i file già esistenti (non sovrascrive i dati ARPA reali)
 * 
 * Uso: node populate-history.js
 * Prerequisiti: Node.js 18+
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Configurazione ─────────────────────────────────────────────
const DAYS_BACK = 365;
const BATCH_SIZE = 50; // stazioni per chiamata Open-Meteo
const DELAY_MS = 3000;  // delay tra chiamate per non fare rate limit

const REGIONS = {
  piemonte: {
    dir: path.join(__dirname, 'data', 'piemonte'),
    stations: [
      {n:"Torino",lat:45.070,lon:7.686,q:240,p:"TO"},
      {n:"Moncalieri",lat:44.998,lon:7.687,q:260,p:"TO"},
      {n:"Rivoli",lat:45.072,lon:7.516,q:390,p:"TO"},
      {n:"Chieri",lat:44.963,lon:7.822,q:315,p:"TO"},
      {n:"Ivrea",lat:45.467,lon:7.873,q:253,p:"TO"},
      {n:"Chivasso",lat:45.192,lon:7.888,q:188,p:"TO"},
      {n:"Settimo Torinese",lat:45.141,lon:7.773,q:207,p:"TO"},
      {n:"Collegno",lat:45.079,lon:7.574,q:305,p:"TO"},
      {n:"Pinerolo",lat:44.884,lon:7.329,q:376,p:"TO"},
      {n:"Sestriere",lat:44.958,lon:6.878,q:2024,p:"TO"},
      {n:"Ceresole Reale",lat:45.426,lon:7.226,q:1616,p:"TO"},
      {n:"Susa",lat:45.138,lon:7.048,q:503,p:"TO"},
      {n:"Bardonecchia",lat:45.080,lon:6.702,q:1312,p:"TO"},
      {n:"Lanzo Torinese",lat:45.270,lon:7.476,q:515,p:"TO"},
      {n:"Ala di Stura",lat:45.329,lon:7.330,q:1035,p:"TO"},
      {n:"Locana",lat:45.415,lon:7.460,q:607,p:"TO"},
      {n:"Cantoira",lat:45.363,lon:7.334,q:745,p:"TO"},
      {n:"Coazze",lat:45.018,lon:7.290,q:752,p:"TO"},
      {n:"Cuneo",lat:44.385,lon:7.542,q:534,p:"CN"},
      {n:"Saluzzo",lat:44.645,lon:7.490,q:395,p:"CN"},
      {n:"Fossano",lat:44.551,lon:7.725,q:400,p:"CN"},
      {n:"Mondovì",lat:44.388,lon:7.819,q:399,p:"CN"},
      {n:"Alba",lat:44.700,lon:8.033,q:172,p:"CN"},
      {n:"Bra",lat:44.697,lon:7.855,q:290,p:"CN"},
      {n:"Borgo San Dalmazzo",lat:44.329,lon:7.487,q:649,p:"CN"},
      {n:"Demonte",lat:44.314,lon:7.295,q:770,p:"CN"},
      {n:"Entracque",lat:44.237,lon:7.390,q:904,p:"CN"},
      {n:"Limone Piemonte",lat:44.200,lon:7.570,q:1010,p:"CN"},
      {n:"Vinadio",lat:44.307,lon:7.179,q:905,p:"CN"},
      {n:"Garessio",lat:44.205,lon:8.024,q:626,p:"CN"},
      {n:"Ceva",lat:44.388,lon:8.036,q:330,p:"CN"},
      {n:"Dronero",lat:44.467,lon:7.363,q:622,p:"CN"},
      {n:"Asti",lat:44.900,lon:8.207,q:123,p:"AT"},
      {n:"Nizza Monferrato",lat:44.776,lon:8.354,q:138,p:"AT"},
      {n:"Alessandria",lat:44.912,lon:8.615,q:95,p:"AL"},
      {n:"Casale Monf.",lat:45.133,lon:8.452,q:113,p:"AL"},
      {n:"Acqui Terme",lat:44.674,lon:8.469,q:156,p:"AL"},
      {n:"Tortona",lat:44.896,lon:8.866,q:122,p:"AL"},
      {n:"Novi Ligure",lat:44.760,lon:8.795,q:197,p:"AL"},
      {n:"Ovada",lat:44.638,lon:8.647,q:186,p:"AL"},
      {n:"Novara",lat:45.446,lon:8.621,q:162,p:"NO"},
      {n:"Arona",lat:45.762,lon:8.556,q:212,p:"NO"},
      {n:"Borgomanero",lat:45.696,lon:8.465,q:307,p:"NO"},
      {n:"Verbania",lat:45.921,lon:8.552,q:197,p:"VB"},
      {n:"Domodossola",lat:46.113,lon:8.294,q:272,p:"VB"},
      {n:"Omegna",lat:45.878,lon:8.407,q:301,p:"VB"},
      {n:"Macugnaga",lat:45.964,lon:7.963,q:1327,p:"VB"},
      {n:"Formazza",lat:46.381,lon:8.429,q:1280,p:"VB"},
      {n:"Baceno",lat:46.257,lon:8.314,q:908,p:"VB"},
      {n:"Vercelli",lat:45.326,lon:8.418,q:130,p:"VC"},
      {n:"Borgosesia",lat:45.716,lon:8.275,q:354,p:"VC"},
      {n:"Varallo",lat:45.818,lon:8.254,q:453,p:"VC"},
      {n:"Alagna Valsesia",lat:45.864,lon:7.940,q:1195,p:"VC"},
      {n:"Biella",lat:45.563,lon:8.058,q:420,p:"BI"},
      {n:"Oropa",lat:45.621,lon:8.006,q:1180,p:"BI"},
      {n:"Pray",lat:45.674,lon:8.235,q:450,p:"BI"}
    ]
  },
  veneto: {
    dir: path.join(__dirname, 'data', 'veneto'),
    stations: [
      {n:"Venezia",lat:45.438,lon:12.335,q:2,p:"VE"},
      {n:"Verona",lat:45.438,lon:11.002,q:59,p:"VR"},
      {n:"Padova",lat:45.407,lon:11.868,q:12,p:"PD"},
      {n:"Vicenza",lat:45.548,lon:11.546,q:39,p:"VI"},
      {n:"Treviso",lat:45.671,lon:12.243,q:15,p:"TV"},
      {n:"Belluno",lat:46.144,lon:12.218,q:389,p:"BL"},
      {n:"Rovigo",lat:45.071,lon:11.790,q:5,p:"RO"},
      {n:"Cortina",lat:46.536,lon:12.136,q:1224,p:"BL"},
      {n:"Asiago",lat:45.874,lon:11.511,q:1001,p:"VI"},
      {n:"Bassano del Grappa",lat:45.766,lon:11.735,q:129,p:"VI"},
      {n:"Castelfranco V.",lat:45.671,lon:11.928,q:42,p:"TV"},
      {n:"Conegliano",lat:45.888,lon:12.297,q:72,p:"TV"},
      {n:"Este",lat:45.226,lon:11.656,q:14,p:"PD"},
      {n:"Chioggia",lat:45.219,lon:12.279,q:1,p:"VE"},
      {n:"Adria",lat:45.054,lon:12.053,q:4,p:"RO"},
      {n:"Vittorio Veneto",lat:45.989,lon:12.299,q:138,p:"TV"},
      {n:"Montebelluna",lat:45.777,lon:12.043,q:109,p:"TV"},
      {n:"Mestre",lat:45.491,lon:12.238,q:3,p:"VE"},
      {n:"San Dona di Piave",lat:45.629,lon:12.565,q:3,p:"VE"},
      {n:"Portogruaro",lat:45.776,lon:12.836,q:8,p:"VE"},
      {n:"Jesolo",lat:45.536,lon:12.641,q:2,p:"VE"},
      {n:"Mirano",lat:45.496,lon:12.102,q:11,p:"VE"},
      {n:"Monselice",lat:45.238,lon:11.741,q:9,p:"PD"},
      {n:"Cittadella",lat:45.647,lon:11.784,q:49,p:"PD"},
      {n:"Thiene",lat:45.709,lon:11.476,q:65,p:"VI"},
      {n:"Schio",lat:45.710,lon:11.356,q:89,p:"VI"},
      {n:"Valdagno",lat:45.649,lon:11.302,q:219,p:"VI"},
      {n:"Lonigo",lat:45.385,lon:11.381,q:31,p:"VI"},
      {n:"Bussolengo",lat:45.472,lon:10.856,q:68,p:"VR"},
      {n:"Legnago",lat:45.192,lon:11.313,q:17,p:"VR"},
      {n:"San Bonifacio",lat:45.394,lon:11.272,q:31,p:"VR"},
      {n:"Bardolino",lat:45.548,lon:10.726,q:65,p:"VR"},
      {n:"Malcesine",lat:45.763,lon:10.810,q:90,p:"VR"},
      {n:"Boscochiesanuova",lat:45.627,lon:11.055,q:1027,p:"VR"},
      {n:"Feltre",lat:46.018,lon:11.905,q:340,p:"BL"},
      {n:"Agordo",lat:46.274,lon:12.039,q:611,p:"BL"},
      {n:"Pieve di Cadore",lat:46.427,lon:12.369,q:879,p:"BL"},
      {n:"Longarone",lat:46.273,lon:12.298,q:478,p:"BL"},
      {n:"Auronzo di Cadore",lat:46.559,lon:12.443,q:864,p:"BL"},
      {n:"Oderzo",lat:45.779,lon:12.488,q:15,p:"TV"},
      {n:"Valdobbiadene",lat:45.898,lon:11.998,q:255,p:"TV"},
      {n:"Pieve di Soligo",lat:45.900,lon:12.178,q:132,p:"TV"},
      {n:"Porto Tolle",lat:44.961,lon:12.327,q:1,p:"RO"},
      {n:"Badia Polesine",lat:45.094,lon:11.502,q:8,p:"RO"},
      {n:"Lendinara",lat:45.081,lon:11.600,q:8,p:"RO"}
    ]
  }
};

// ── Utility ────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fetchURL(url, retries=3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 429) {
            if (n > 0) {
              console.warn('\n  429 Too Many Requests — aspetto 10 secondi...');
              setTimeout(() => attempt(n-1), 10000);
            } else reject(new Error('429 dopo tutti i retry'));
          } else if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
      }).on('error', reject);
    };
    attempt(retries);
  });
}

// ── Fetch Open-Meteo Archive per un giorno ─────────────────────
async function fetchDayOM(stations, dateStr) {
  const lats = stations.map(s => s.lat).join(',');
  const lons = stations.map(s => s.lon).join(',');
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lats}&longitude=${lons}&daily=precipitation_sum&timezone=Europe%2FRome&start_date=${dateStr}&end_date=${dateStr}`;
  
  const raw = await fetchURL(url);
  const data = JSON.parse(raw);
  
  const results = [];
  const arr = Array.isArray(data) ? data : [data];
  
  arr.forEach((loc, i) => {
    const s = stations[i];
    if (!s) return;
    const mm = (loc.daily && loc.daily.precipitation_sum && loc.daily.precipitation_sum[0]) || 0;
    results.push({
      id:  `om_${i}`,
      n:   s.n,
      lat: s.lat,
      lon: s.lon,
      q:   s.q,
      p:   s.p,
      mm:  mm > 300 ? 0 : Math.round((mm || 0) * 10) / 10
    });
  });
  
  return results;
}

// ── Processa una regione ───────────────────────────────────────
async function processRegion(regionName, cfg) {
  console.log(`\n=== ${regionName.toUpperCase()} ===`);
  
  if (!fs.existsSync(cfg.dir)) {
    fs.mkdirSync(cfg.dir, { recursive: true });
  }
  
  // Genera lista di date
  const today = new Date();
  const dates = [];
  for (let i = 1; i <= DAYS_BACK; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600000);
    dates.push(fmtDate(d));
  }
  
  let created = 0, skipped = 0, errors = 0;
  
  for (const dateStr of dates) {
    const outFile = path.join(cfg.dir, `${dateStr}.json`);
    
    // Salta se file già esiste (non sovrascrive dati ARPA reali)
    if (fs.existsSync(outFile)) {
      skipped++;
      continue;
    }
    
    try {
      const stations = [];
      
      // Processa in batch per non superare limite URL
      for (let i = 0; i < cfg.stations.length; i += BATCH_SIZE) {
        const batch = cfg.stations.slice(i, i + BATCH_SIZE);
        const batchResults = await fetchDayOM(batch, dateStr);
        stations.push(...batchResults);
        if (i + BATCH_SIZE < cfg.stations.length) await sleep(200);
      }
      
      if (stations.length < 3) {
        errors++;
        continue;
      }
      
      fs.writeFileSync(outFile, JSON.stringify({
        date:      dateStr,
        collected: new Date().toISOString(),
        source:    'open-meteo-archive',
        count:     stations.length,
        stations
      }));
      
      created++;
      process.stdout.write(`  ${dateStr} ✓ (${stations.length} stazioni)\r`);
      
      await sleep(DELAY_MS);
      
    } catch(e) {
      console.warn(`\n  ${dateStr} errore: ${e.message}`);
      errors++;
      await sleep(1000);
    }
  }
  
  console.log(`\n  Creati: ${created} | Saltati (già esistenti): ${skipped} | Errori: ${errors}`);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n🍄 Pre-popolamento storico Open-Meteo Archive`);
  console.log(`   Periodo: ultimi ${DAYS_BACK} giorni`);
  console.log(`   I file ARPA esistenti non verranno sovrascritti\n`);
  
  for (const [name, cfg] of Object.entries(REGIONS)) {
    await processRegion(name, cfg);
  }
  
  console.log('\n✅ Completato! Carica data/piemonte/ e data/veneto/ su GitHub.');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
