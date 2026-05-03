/**
 * collect-piemonte.js
 * Raccoglie i dati di precipitazione giornaliera da ARPA Piemonte API realtime
 * e li salva in data/piemonte/YYYY-MM-DD.json
 * Cancella automaticamente i file più vecchi di 365 giorni
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', '..', 'data', 'piemonte');
const MAX_DAYS   = 365;
const API_BASE   = 'https://utility.arpa.piemonte.it/api_realtime';

// ─── Data target ────────────────────────────────────────────────
function getTargetDate() {
  if (process.env.DATE_OVERRIDE) {
    return process.env.DATE_OVERRIDE; // YYYY-MM-DD
  }
  // Oggi in ora italiana (UTC+1/+2) — usiamo UTC+1 per sicurezza
  const now = new Date();
  const italy = new Date(now.getTime() + 60 * 60 * 1000); // UTC+1
  return italy.toISOString().substring(0, 10);
}

// ─── Fetch con retry ─────────────────────────────────────────────
async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`  tentativo ${i+1}/${retries} fallito: ${e.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error(`fetch fallito dopo ${retries} tentativi: ${url}`);
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Piemonte per ${targetDate} ===\n`);

  // Crea cartella se non esiste
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Cartella creata: ${DATA_DIR}`);
  }

  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: lista stazioni pluviometriche ────────────────────
  console.log('Carico elenco stazioni pluviometriche...');
  let stazioni = [];
  try {
    const data = await fetchJSON(`${API_BASE}/stazioni/?id_sensore_type=PREC&format=json`);
    // L'API potrebbe restituire array diretto o { results: [...] }
    stazioni = Array.isArray(data) ? data : (data.results || data.features || []);
    console.log(`  Stazioni trovate: ${stazioni.length}`);
  } catch (e) {
    console.error('Errore caricamento stazioni:', e.message);
    process.exit(1);
  }

  if (stazioni.length === 0) {
    console.error('Nessuna stazione trovata, uscita.');
    process.exit(1);
  }

  // ── Step 2: misure precipitazione ultime 24h ─────────────────
  console.log('Carico misure precipitazione ultime 24h...');
  let misure = [];
  try {
    const data = await fetchJSON(`${API_BASE}/misure/?id_sensore_type=PREC&ore=24&format=json`);
    misure = Array.isArray(data) ? data : (data.results || data.features || []);
    console.log(`  Misure trovate: ${misure.length}`);
  } catch (e) {
    console.error('Errore caricamento misure:', e.message);
    process.exit(1);
  }

  // ── Step 3: mappa idstazione → mm giornalieri ────────────────
  // L'API Piemonte usa contatore cumulativo come ARPA Lombardia
  // Calcoliamo max - min per ogni stazione nelle ultime 24h
  const stMap = {}; // idstaz → { vals: [], ... }

  misure.forEach(m => {
    const id = m.idstazione || m.id_stazione || m.codice;
    const val = parseFloat(m.valore || m.value || m.precipitazione);
    if (!id || isNaN(val) || val < 0) return;
    if (!stMap[id]) stMap[id] = { vals: [] };
    stMap[id].vals.push(val);
  });

  // ── Step 4: costruisci output per stazione ───────────────────
  const output = [];

  stazioni.forEach(s => {
    const id = s.idstazione || s.id_stazione || s.codice;
    const lat = parseFloat(s.lat || s.latitude || s.y);
    const lon = parseFloat(s.lon || s.lng || s.longitude || s.x);
    const nome = s.nomestazione || s.nome || s.name || '—';
    const quota = parseInt(s.quota || s.altitude || 0) || 0;
    const prov = s.provincia || s.prov || '—';

    if (!id || isNaN(lat) || isNaN(lon)) return;
    // Filtra solo Piemonte (bbox approssimativa)
    if (lat < 43.8 || lat > 46.5 || lon < 6.6 || lon > 9.3) return;

    let mm = 0;
    if (stMap[id] && stMap[id].vals.length >= 2) {
      const max = Math.max(...stMap[id].vals);
      const min = Math.min(...stMap[id].vals);
      mm = Math.max(0, max - min);
      if (mm > 300) mm = 0; // cap valori anomali
    } else if (stMap[id] && stMap[id].vals.length === 1) {
      mm = Math.max(0, stMap[id].vals[0]);
      if (mm > 300) mm = 0;
    }

    output.push({
      id,
      n: nome,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q: quota,
      p: prov,
      mm: Math.round(mm * 10) / 10
    });
  });

  console.log(`  Stazioni elaborate: ${output.length}`);

  if (output.length < 5) {
    console.error('Troppo poche stazioni elaborate, probabile errore API. Uscita senza salvare.');
    process.exit(1);
  }

  // ── Step 5: salva file JSON ───────────────────────────────────
  const fileData = {
    date: targetDate,
    collected: new Date().toISOString(),
    count: output.length,
    stations: output
  };

  fs.writeFileSync(outFile, JSON.stringify(fileData), 'utf8');
  console.log(`\nSalvato: ${outFile} (${output.length} stazioni)`);

  // ── Step 6: pulizia file più vecchi di 365 giorni ────────────
  console.log('\nPulizia file storici...');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);

  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  let deleted = 0;
  allFiles.forEach(f => {
    const fileDate = f.replace('.json', '');
    if (fileDate < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      console.log(`  Eliminato: ${f}`);
      deleted++;
    }
  });

  const remaining = allFiles.length - deleted;
  console.log(`  File eliminati: ${deleted} | File rimanenti: ${remaining}`);
  console.log(`\n=== Completato! ===\n`);
}

main().catch(e => {
  console.error('Errore fatale:', e);
  process.exit(1);
});
