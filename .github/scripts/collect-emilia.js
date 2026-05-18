/**
 * collect-emilia.js
 * Fonte: apps.arpae.it/REST/meteo_giornalieri
 * 347 stazioni con precipitazione_cumulata_giornaliera
 * Aggiornamento: ogni 4 ore via GitHub Actions
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'emilia');
const MAX_DAYS = 365;
const API_URL  = 'https://apps.arpae.it/REST/meteo_giornalieri?max_results=1000';

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  const now = new Date();
  const italy = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + 3600000);
  return italy.toISOString().substring(0, 10);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
  console.log(`\n=== Raccolta dati Emilia Romagna per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── Step 1: scarica dati ARPAE ─────────────────────────────
  console.log('Scarico dati da ARPAE...');
  let raw;
  try {
    raw = await fetchJSON(API_URL);
  } catch(e) {
    console.error('Errore fetch ARPAE:', e.message);
    process.exit(1);
  }

  const items = raw._items || [];
  console.log(`  Stazioni ricevute: ${items.length}`);

  // ── Step 2: converti data target in formato ARPAE (YYYYMMDD) ─
  const dateKey = targetDate.replace(/-/g, ''); // es. 20260517

  // ── Step 3: estrai dati del giorno target ───────────────────
  const output = [];
  let ok = 0, skip = 0;

  items.forEach(s => {
    try {
      const ana = s.anagrafica;
      if (!ana || !ana.geometry || !ana.geometry.coordinates) { skip++; return; }

      const lon = ana.geometry.coordinates[0];
      const lat = ana.geometry.coordinates[1];

      // Bounding box Emilia Romagna
      if (lat < 43.7 || lat > 45.2 || lon < 9.1 || lon > 12.8) { skip++; return; }

      // Solo stazioni con precipitazione
      if (!ana.variabili || !ana.variabili.includes('precipitazione_cumulata_giornaliera')) { skip++; return; }

      // Cerca il dato del giorno target
      const dati = s.dati || {};
      const dayData = dati[dateKey];
      let mm = 0;

      if (dayData && dayData['0000'] && dayData['0000'].precipitazione_cumulata_giornaliera !== undefined) {
        const val = parseFloat(dayData['0000'].precipitazione_cumulata_giornaliera);
        if (!isNaN(val) && val >= 0 && val < 500) mm = Math.round(val * 10) / 10;
      }

      output.push({
        id:  s._id,
        n:   ana.nome || '—',
        lat: Math.round(lat * 10000) / 10000,
        lon: Math.round(lon * 10000) / 10000,
        q:   ana.altitudine || 0,
        p:   ana.provincia || '—',
        mm
      });
      ok++;
    } catch(e) {
      skip++;
    }
  });

  console.log(`  Stazioni Emilia: ${ok} | Saltate: ${skip}`);

  // ── Step 4: merge con file esistente ────────────────────────
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);
  let existingMap = {};

  if (fs.existsSync(outFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.stations) {
        existing.stations.forEach(s => { existingMap[s.id] = s; });
        console.log(`  File esistente: ${existing.stations.length} stazioni`);
      }
    } catch(e) {
      console.log('  Nessun file esistente, creo nuovo.');
    }
  }

  // Merge: prendi il valore massimo
  const merged = Object.assign({}, existingMap);
  output.forEach(s => {
    if (merged[s.id]) {
      merged[s.id].mm = Math.max(merged[s.id].mm, s.mm);
    } else {
      merged[s.id] = s;
    }
  });

  const finalOutput = Object.values(merged);
  console.log(`  Stazioni finali: ${finalOutput.length}`);

  if (finalOutput.length < 10) {
    console.error('Troppo poche stazioni, uscita senza salvare.');
    process.exit(1);
  }

  // ── Step 5: salva ────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date:      targetDate,
    collected: new Date().toISOString(),
    source:    'arpa-emilia-arpae',
    count:     finalOutput.length,
    stations:  finalOutput
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${finalOutput.length} stazioni)`);

  // ── Step 6: pulizia ──────────────────────────────────────────
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
