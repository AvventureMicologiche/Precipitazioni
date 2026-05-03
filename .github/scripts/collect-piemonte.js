/**
 * collect-piemonte.js
 * Raccoglie dati precipitazione giornaliera da ARPA Piemonte
 * API: https://utility.arpa.piemonte.it/api_realtime
 * Endpoints: /pie_anag (stazioni) + /data_pie (misure)
 * Salva in data/piemonte/YYYY-MM-DD.json
 * Cancella file più vecchi di 365 giorni
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'piemonte');
const MAX_DAYS = 365;
const API_BASE = 'https://utility.arpa.piemonte.it/api_realtime';

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    return process.env.DATE_OVERRIDE.trim();
  }
  const now = new Date();
  const italy = new Date(now.getTime() + 60 * 60 * 1000);
  return italy.toISOString().substring(0, 10);
}

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
  throw new Error(`fetch fallito dopo ${retries} tentativi`);
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Piemonte per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: anagrafica stazioni ──────────────────────────────
  console.log('Carico anagrafica stazioni...');
  const anagData = await fetchJSON(`${API_BASE}/pie_anag?page_size=10000`);
  const stazioni = Array.isArray(anagData) ? anagData : (anagData.data || anagData.results || []);
  console.log(`  Stazioni totali: ${stazioni.length}`);
  console.log(`  Esempio stazione:`, JSON.stringify(stazioni[0]).substring(0, 200));

  // ── Step 2: dati precipitazione del giorno ───────────────────
  // Prendiamo tutto il giorno: 00:00 → 23:59
  const dateFrom = `${targetDate}T00:00`;
  const dateTo   = `${targetDate}T23:59`;
  console.log(`\nCarico misure ${dateFrom} → ${dateTo}...`);

  let allMisure = [];
  let page = 1;
  while (true) {
    const url = `${API_BASE}/data_pie?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}&page=${page}&page_size=10000`;
    const data = await fetchJSON(url);
    const records = Array.isArray(data) ? data : (data.data || data.results || []);
    console.log(`  Pagina ${page}: ${records.length} record`);
    if (records.length === 0) break;
    allMisure = allMisure.concat(records);
    if (records.length < 10000) break;
    page++;
  }
  console.log(`  Totale misure: ${allMisure.length}`);
  if (allMisure.length > 0) {
    console.log(`  Esempio misura:`, JSON.stringify(allMisure[0]).substring(0, 200));
  }

  // ── Step 3: calcola mm per stazione (max-min) ────────────────
  // Raggruppa misure per stazione, filtra solo precipitazione
  const stMap = {};
  allMisure.forEach(m => {
    // Cerca il campo precipitazione — potrebbe chiamarsi in vari modi
    const keys = Object.keys(m);
    console.log('  Chiavi misura:', keys.join(', '));
    // Stampa solo la prima per debug
    if (Object.keys(stMap).length === 0) {
      console.log('  Prima misura completa:', JSON.stringify(m));
    }

    const id = m.station_code || m.codice || m.id_stazione || m.stazione;
    if (!id) return;
    if (!stMap[id]) stMap[id] = [];
    // Cerca valore precipitazione
    const prec = m.precipitation || m.precipitazione || m.prec || m.PREC || m.pioggia || m.rain;
    if (prec !== undefined && prec !== null) {
      const v = parseFloat(prec);
      if (!isNaN(v) && v >= 0) stMap[id].push(v);
    }
  });

  // ── Step 4: costruisci output ─────────────────────────────────
  const stIndex = {};
  stazioni.forEach(s => {
    const id = s.station_code || s.codice || s.id_stazione;
    if (id) stIndex[id] = s;
  });

  const output = [];
  Object.keys(stMap).forEach(id => {
    const vals = stMap[id];
    if (vals.length === 0) return;
    const s = stIndex[id] || {};
    const lat = parseFloat(s.lat || s.latitude || s.y || 0);
    const lon = parseFloat(s.lon || s.longitude || s.x || 0);
    if (!lat || !lon) return;
    if (lat < 43.8 || lat > 46.5 || lon < 6.6 || lon > 9.3) return;

    let mm = 0;
    if (vals.length >= 2) {
      mm = Math.max(0, Math.max(...vals) - Math.min(...vals));
    } else {
      mm = Math.max(0, vals[0]);
    }
    if (mm > 300) mm = 0;

    output.push({
      id,
      n: s.station_name || s.nome || s.name || id,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q: parseInt(s.altitude || s.quota || 0) || 0,
      p: s.province || s.provincia || s.prov || '—',
      mm: Math.round(mm * 10) / 10
    });
  });

  console.log(`\n  Stazioni con dati: ${output.length}`);

  if (output.length < 3) {
    console.warn('Poche stazioni, salvo comunque per debug...');
  }

  // ── Step 5: salva ─────────────────────────────────────────────
  const fileData = { date: targetDate, collected: new Date().toISOString(), count: output.length, stations: output };
  fs.writeFileSync(outFile, JSON.stringify(fileData), 'utf8');
  console.log(`\nSalvato: ${outFile}`);

  // ── Step 6: pulizia vecchi file ───────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json','') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log(`Pulizia: ${deleted} file eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
