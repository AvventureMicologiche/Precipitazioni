/**
 * collect-liguria.js
 * Fonte: omirl.regione.liguria.it (stazioni pluviometriche)
 * Endpoint: /Omirl/rest/stations/Pluvio → 199 stazioni con mm ultima ora
 * Nota: OMIRL fornisce solo dati real-time (ultima misura).
 *       Lo script accumula i mm giornalieri sommando le chiamate nel corso del giorno.
 *       Se il file del giorno esiste già, aggiorna solo le stazioni con valore maggiore.
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'liguria');
const MAX_DAYS = 365;
const OMIRL_URL = 'https://omirl.regione.liguria.it/Omirl/rest/stations/Pluvio';

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  // Ora italiana (UTC+1 o UTC+2)
  const now = new Date();
  const italy = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (3600000));
  return italy.toISOString().substring(0, 10);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Liguria per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: scarica dati OMIRL ─────────────────────────────────
  console.log('Scarico dati da OMIRL...');
  let rawStations;
  try {
    rawStations = await fetchJSON(OMIRL_URL);
  } catch(e) {
    console.error('Errore fetch OMIRL:', e.message);
    process.exit(1);
  }
  console.log(`  Stazioni ricevute: ${rawStations.length}`);

  // ── Step 2: filtra e normalizza ────────────────────────────────
  // Bounding box Liguria + margine per stazioni di confine
  const newData = {};
  rawStations.forEach(s => {
    if (!s.lat || !s.lon || !s.name) return;
    if (s.lat < 43.7 || s.lat > 44.8 || s.lon < 7.4 || s.lon > 10.3) return;
    const mm = (typeof s.value === 'number' && s.value >= 0 && s.value < 500) ? s.value : 0;
    newData[s.shortCode] = {
      id:  s.shortCode,
      n:   s.name,
      lat: Math.round(s.lat * 10000) / 10000,
      lon: Math.round(s.lon * 10000) / 10000,
      q:   s.alt || 0,
      p:   s.municipality || '',
      mm:  Math.round(mm * 10) / 10
    };
  });
  console.log(`  Stazioni in Liguria: ${Object.keys(newData).length}`);

  // ── Step 3: merge con file esistente (accumulo giornaliero) ───
  // OMIRL dà l'ultimo valore real-time, non il cumulato del giorno.
  // Manteniamo il valore massimo tra quello esistente e il nuovo.
  let existingStations = {};
  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.stations) {
        existing.stations.forEach(s => { existingStations[s.id] = s; });
        console.log(`  File esistente: ${existing.stations.length} stazioni`);
      }
    } catch(e) {
      console.log('  Nessun file esistente o corrotto, creo nuovo.');
    }
  }

  // Merge: prendi il valore massimo (accumulo nel corso del giorno)
  const merged = {};
  // Prima aggiungi tutti quelli esistenti
  Object.assign(merged, existingStations);
  // Poi aggiorna con i nuovi (prende il max dei mm)
  Object.values(newData).forEach(s => {
    if (merged[s.id]) {
      merged[s.id].mm = Math.max(merged[s.id].mm, s.mm);
    } else {
      merged[s.id] = s;
    }
  });

  const output = Object.values(merged);
  console.log(`  Stazioni finali: ${output.length}`);

  if (output.length < 10) {
    console.error('Troppo poche stazioni, uscita senza salvare.');
    process.exit(1);
  }

  // ── Step 4: salva ─────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date:      targetDate,
    collected: new Date().toISOString(),
    source:    'arpa-liguria-omirl',
    count:     output.length,
    stations:  output
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${output.length} stazioni)`);

  // ── Step 5: pulizia ───────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json', '') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
