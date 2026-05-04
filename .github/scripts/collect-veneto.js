/**
 * collect-veneto.js
 * Scarica l'XML ARPAV (ultime 48h), estrae i dati del giorno target
 * e salva in data/veneto/YYYY-MM-DD.json
 * Cancella file più vecchi di 365 giorni
 */
const fs   = require('fs');
const path = require('path');
const http = require('https');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'veneto');
const MAX_DAYS = 365;
const XML_URL  = 'https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml';

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) {
    return process.env.DATE_OVERRIDE.trim();
  }
  const now   = new Date();
  const italy = new Date(now.getTime() + 60 * 60 * 1000); // UTC+1
  return italy.toISOString().substring(0, 10);
}

function fetchXML(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { Accept: 'text/xml' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : null;
}

function getCDATA(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]><\/${tag}>`));
  return m ? m[1].trim() : null;
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Veneto per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: scarica XML ───────────────────────────────────────
  console.log('Scarico XML ARPAV...');
  let xml;
  try {
    xml = await fetchXML(XML_URL);
    console.log(`  XML scaricato: ${xml.length} chars`);
  } catch(e) {
    console.error('Errore download XML:', e.message);
    process.exit(1);
  }

  // ── Step 2: parse stazioni con PRECCUM ───────────────────────
  // Formato ISTANTE: YYYYMMDDHHNN (es. 202605031430)
  // Filtra solo misure del giorno target
  const targetPrefix = targetDate.replace(/-/g, ''); // es. 20260503

  const output = [];
  const stazRegex = /<STAZIONE>([\s\S]*?)<\/STAZIONE>/g;
  let stazMatch;

  while ((stazMatch = stazRegex.exec(xml)) !== null) {
    const stazXml = stazMatch[1];

    const id    = getTag(stazXml, 'IDSTAZ');
    const nome  = getCDATA(stazXml, 'NOME') || getTag(stazXml, 'NOME') || '—';
    const lon   = parseFloat(getTag(stazXml, 'X'));
    const lat   = parseFloat(getTag(stazXml, 'Y'));
    const quota = parseInt(getTag(stazXml, 'QUOTA')) || 0;
    const prov  = getTag(stazXml, 'PROVINCIA') || '—';

    if (!id || isNaN(lat) || isNaN(lon)) continue;
    if (lat < 44.7 || lat > 46.8 || lon < 10.6 || lon > 13.2) continue;

    // Cerca sensore PRECCUM
    const sensoreRegex = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
    let sensMatch;
    let mmGiorno = 0;
    let found = false;

    while ((sensMatch = sensoreRegex.exec(stazXml)) !== null) {
      const sensXml = sensMatch[1];
      const type    = getTag(sensXml, 'TYPE');
      if (type !== 'PRECCUM') continue;

      // Filtra solo misure del giorno target
      const datiRegex = /<DATI ISTANTE="(\d{12})"><VM>([\d.-]+)<\/VM><\/DATI>/g;
      let datiMatch;
      const vals = [];

      while ((datiMatch = datiRegex.exec(sensXml)) !== null) {
        const istante = datiMatch[1]; // YYYYMMDDHHNN
        if (!istante.startsWith(targetPrefix)) continue;
        const v = parseFloat(datiMatch[2]);
        if (!isNaN(v) && v >= 0) vals.push(v);
      }

      if (vals.length >= 2) {
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        mmGiorno  = Math.max(0, max - min);
        if (mmGiorno > 300) mmGiorno = 0;
      } else if (vals.length === 1) {
        mmGiorno = Math.max(0, vals[0]);
      }
      found = true;
      break;
    }

    if (!found) continue; // stazione senza pluviometro

    output.push({
      id:  id,
      n:   nome,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      q:   quota,
      p:   prov,
      mm:  Math.round(mmGiorno * 10) / 10
    });
  }

  console.log(`  Stazioni elaborate: ${output.length}`);

  if (output.length < 5) {
    console.error('Troppo poche stazioni, uscita senza salvare.');
    process.exit(1);
  }

  // ── Step 3: salva ─────────────────────────────────────────────
  const fileData = {
    date:      targetDate,
    collected: new Date().toISOString(),
    count:     output.length,
    stations:  output
  };
  fs.writeFileSync(outFile, JSON.stringify(fileData), 'utf8');
  console.log(`\nSalvato: ${outFile} (${output.length} stazioni)`);

  // ── Step 4: pulizia ───────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json','') < cutoffStr) {
      fs.unlinkSync(path.join(DATA_DIR, f));
      deleted++;
    }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
