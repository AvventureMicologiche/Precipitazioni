/**
 * collect-veneto.js - Versione corretta
 * Fonte: meteo.arpa.veneto.it (stazioni METEO con sensore PREC)
 * Struttura: stazioni.xml → lista stazioni METEO → per ogni stazione NNNN.xml → sensore PREC
 */
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', 'data', 'veneto');
const MAX_DAYS  = 365;
const BASE_URL  = 'https://meteo.arpa.veneto.it/meteo/dati_meteo/xml';

function getTargetDate() {
  if (process.env.DATE_OVERRIDE && process.env.DATE_OVERRIDE.trim()) return process.env.DATE_OVERRIDE.trim();
  const italy = new Date(new Date().getTime() + 60 * 60 * 1000);
  return italy.toISOString().substring(0, 10);
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Accept-Encoding': 'gzip, deflate', 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        const decompress = (e, d) => e ?
          // se gunzip fallisce prova come testo diretto
          resolve(buf.toString('latin1')) :
          resolve(d.toString('latin1'));
        if (enc === 'gzip') zlib.gunzip(buf, decompress);
        else if (enc === 'deflate') zlib.inflate(buf, decompress);
        else zlib.gunzip(buf, decompress);
      });
    }).on('error', reject);
  });
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}

function getCDATA(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]></${tag}>`));
  return m ? m[1].trim() : null;
}

async function main() {
  const targetDate = getTargetDate();
  console.log(`\n=== Raccolta dati Veneto per ${targetDate} ===\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `${targetDate}.json`);

  // ── Step 1: scarica elenco stazioni ────────────────────────────
  console.log('Scarico stazioni.xml...');
  const stazXml = await fetchURL(`${BASE_URL}/stazioni.xml`);

  // Estrae solo stazioni METEO (non idrometriche)
  const stazioni = [];
  const stazRegex = /<STAZIONE>([\s\S]*?)<\/STAZIONE>/g;
  let m;
  while ((m = stazRegex.exec(stazXml)) !== null) {
    const s = m[1];
    const tipo = getTag(s, 'TIPOSTAZ') || '';
    // Includi METEO e AGROMETEO, escludi idrometriche
    if (!tipo.match(/METEO|AGRO/i)) continue;
    const id    = getTag(s, 'IDSTAZ');
    const nome  = getCDATA(s, 'NOME') || getTag(s, 'NOME') || '—';
    const lon   = parseFloat(getTag(s, 'X'));
    const lat   = parseFloat(getTag(s, 'Y'));
    const quota = parseInt(getTag(s, 'QUOTA')) || 0;
    const prov  = getTag(s, 'PROVINCIA') || '—';
    const link  = getTag(s, 'LINKSTAZ');
    if (!id || isNaN(lat) || isNaN(lon) || !link) continue;
    if (lat < 44.7 || lat > 46.8 || lon < 10.5 || lon > 13.2) continue;
    stazioni.push({ id, nome, lat, lon, quota, prov, link });
  }
  console.log(`  Stazioni METEO trovate: ${stazioni.length}`);

  // ── Step 2: scarica dati di ogni stazione ──────────────────────
  const targetPrefix = targetDate.replace(/-/g, ''); // es. 20260505
  const output = [];
  let ok = 0, skip = 0;

  // Processa in batch di 10 per non sovraccaricare il server
  const BATCH = 10;
  for (let i = 0; i < stazioni.length; i += BATCH) {
    const batch = stazioni.slice(i, i + BATCH);
    await Promise.all(batch.map(async (s) => {
      try {
        const xml = await fetchURL(`${BASE_URL}/${s.link}`);
        // Cerca sensore PREC
        const sensoreRegex = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
        let sm;
        while ((sm = sensoreRegex.exec(xml)) !== null) {
          const sens = sm[1];
          const type = getTag(sens, 'TYPE');
          if (type !== 'PREC') continue;
          // Dati del giorno target: max - min
          const datiRegex = /<DATI ISTANTE="(\d{12})"><VM>([\d.]+)<\/VM><\/DATI>/g;
          let dm;
          const vals = [];
          while ((dm = datiRegex.exec(sens)) !== null) {
            if (!dm[1].startsWith(targetPrefix)) continue;
            const v = parseFloat(dm[2]);
            if (!isNaN(v) && v >= 0) vals.push(v);
          }
          let mm = 0;
          if (vals.length >= 2) mm = Math.max(0, Math.max(...vals) - Math.min(...vals));
          else if (vals.length === 1) mm = vals[0];
          if (mm > 300) mm = 0;
          output.push({
            id:  s.id,
            n:   s.nome,
            lat: Math.round(s.lat * 10000) / 10000,
            lon: Math.round(s.lon * 10000) / 10000,
            q:   s.quota,
            p:   s.prov,
            mm:  Math.round(mm * 10) / 10
          });
          ok++;
          break;
        }
      } catch(e) {
        skip++;
      }
    }));
    process.stdout.write(`  Processate ${Math.min(i+BATCH, stazioni.length)}/${stazioni.length} stazioni...\r`);
    // Piccola pausa tra batch
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n  Stazioni con dati PREC: ${ok} | Errori: ${skip}`);

  if (output.length < 5) {
    console.error('Troppo poche stazioni, uscita senza salvare.');
    process.exit(1);
  }

  // ── Step 3: salva ────────────────────────────────────────────────
  fs.writeFileSync(outFile, JSON.stringify({
    date: targetDate,
    collected: new Date().toISOString(),
    count: output.length,
    stations: output
  }), 'utf8');
  console.log(`Salvato: ${outFile} (${output.length} stazioni)`);

  // ── Step 4: pulizia ──────────────────────────────────────────────
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().substring(0, 10);
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  let deleted = 0;
  allFiles.forEach(f => {
    if (f.replace('.json','') < cutoffStr) { fs.unlinkSync(path.join(DATA_DIR, f)); deleted++; }
  });
  console.log(`Pulizia: ${deleted} eliminati, ${allFiles.length - deleted} rimanenti`);
  console.log('\n=== Completato! ===\n');
}

main().catch(e => { console.error('Errore fatale:', e); process.exit(1); });
