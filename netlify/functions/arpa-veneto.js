const fs    = require('fs');
const path  = require('path');
const https = require('https');
const zlib  = require('zlib');

const BASE_URL = 'https://meteo.arpa.veneto.it/meteo/dati_meteo/xml';

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const type   = params.type || 'realtime';

  try {
    // ── STORICO ──────────────────────────────────────────────────
    if (type === 'storico') {
      const date = params.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return { statusCode: 400, headers: cors(), body: JSON.stringify({error:'date required'}) };
      const fp = path.join(__dirname, '..', '..', 'data', 'veneto', `${date}.json`);
      if (!fs.existsSync(fp))
        return { statusCode: 404, headers: cors(), body: JSON.stringify({error:'no data', date}) };
      return { statusCode: 200, headers: {...cors(),'Content-Type':'application/json','Cache-Control':'public,s-maxage=86400'}, body: fs.readFileSync(fp,'utf8') };
    }

    // ── INFO ─────────────────────────────────────────────────────
    if (type === 'info') {
      const dir = path.join(__dirname, '..', '..', 'data', 'veneto');
      let firstDate=null, lastDate=null, count=0;
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
        count = files.length;
        if (files.length) { firstDate=files[0].replace('.json',''); lastDate=files[files.length-1].replace('.json',''); }
      }
      return { statusCode: 200, headers: {...cors(),'Content-Type':'application/json'}, body: JSON.stringify({firstDate,lastDate,count}) };
    }

    // ── REALTIME: scarica stazioni.xml + dati per stazione ───────
    const stazXml = await fetchURL(`${BASE_URL}/stazioni.xml`);
    const stazioni = parseStazioni(stazXml);

    // Per il realtime prendiamo solo le ultime 48h disponibili
    // Scarica in parallelo (batch di 10)
    const oggi = new Date();
    const ieri  = new Date(oggi.getTime() - 24*3600000);
    const targetPrefix1 = fmtDate(oggi).replace(/-/g,'');
    const targetPrefix2 = fmtDate(ieri).replace(/-/g,'');

    const BATCH = 10;
    const results = [];
    for (let i = 0; i < stazioni.length; i += BATCH) {
      const batch = stazioni.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map(s => fetchStazione(s, targetPrefix1, targetPrefix2)));
      batchResults.forEach(r => { if (r) results.push(r); });
    }

    return {
      statusCode: 200,
      headers: {...cors(),'Content-Type':'application/json','Cache-Control':'public,s-maxage=600'},
      body: JSON.stringify({ stations: results, count: results.length })
    };

  } catch(e) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({error: e.message}) };
  }
};

function fmtDate(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: {'Accept-Encoding':'gzip,deflate','Accept':'*/*','User-Agent':'Mozilla/5.0'} }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const dec = (e, d) => resolve(e ? buf.toString('latin1') : d.toString('latin1'));
        zlib.gunzip(buf, dec);
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

function parseStazioni(xml) {
  const out = [];
  const re = /<STAZIONE>([\s\S]*?)<\/STAZIONE>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const s = m[1];
    const tipo = getTag(s, 'TIPOSTAZ') || '';
    if (!tipo.match(/METEO|AGRO/i)) continue;
    const id   = getTag(s, 'IDSTAZ');
    const nome = getCDATA(s, 'NOME') || getTag(s, 'NOME') || '—';
    const lon  = parseFloat(getTag(s, 'X'));
    const lat  = parseFloat(getTag(s, 'Y'));
    const q    = parseInt(getTag(s, 'QUOTA')) || 0;
    const prov = getTag(s, 'PROVINCIA') || '—';
    const link = getTag(s, 'LINKSTAZ');
    if (!id || isNaN(lat) || isNaN(lon) || !link) continue;
    if (lat < 44.7 || lat > 46.8 || lon < 10.5 || lon > 13.2) continue;
    out.push({ id, nome, lat, lon, q, prov, link });
  }
  return out;
}

async function fetchStazione(s, prefix1, prefix2) {
  try {
    const xml = await fetchURL(`${BASE_URL}/${s.link}`);
    const re = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const sens = m[1];
      if (getTag(sens, 'TYPE') !== 'PREC') continue;
      const dr = /<DATI ISTANTE="(\d{12})"><VM>([\d.]+)<\/VM><\/DATI>/g;
      let dm; const vals = [];
      while ((dm = dr.exec(sens)) !== null) {
        if (!dm[1].startsWith(prefix1) && !dm[1].startsWith(prefix2)) continue;
        const v = parseFloat(dm[2]);
        if (!isNaN(v) && v >= 0) vals.push(v);
      }
      let mm = 0;
      if (vals.length >= 2) mm = Math.max(0, Math.max(...vals) - Math.min(...vals));
      else if (vals.length === 1) mm = vals[0];
      if (mm > 300) mm = 0;
      return { id: s.id, name: s.nome, lat: Math.round(s.lat*10000)/10000, lon: Math.round(s.lon*10000)/10000, quota: s.q, prov: s.prov, mm: Math.round(mm*10)/10 };
    }
  } catch(e) {}
  return null;
}

function cors() { return { 'Access-Control-Allow-Origin': '*' }; }
