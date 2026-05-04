const fs   = require('fs');
const path = require('path');

const XML_URL = 'https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml';

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const type   = params.type || 'realtime';

  try {

    // ── STORICO: serve file JSON dal repo data/veneto/YYYY-MM-DD.json ──
    if(type === 'storico'){
      const date = params.date;
      if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
        return { statusCode: 400, headers: cors(), body: JSON.stringify({error:'date param required'}) };
      }
      const filePath = path.join(__dirname, '..', '..', 'data', 'veneto', `${date}.json`);
      if(!fs.existsSync(filePath)){
        return { statusCode: 404, headers: cors(), body: JSON.stringify({error:'no data', date}) };
      }
      const data = fs.readFileSync(filePath, 'utf8');
      return {
        statusCode: 200,
        headers: { ...cors(), 'Content-Type':'application/json', 'Cache-Control':'public, s-maxage=86400' },
        body: data
      };
    }

    // ── INFO: prima e ultima data disponibile ──
    if(type === 'info'){
      const dataDir = path.join(__dirname, '..', '..', 'data', 'veneto');
      let firstDate = null, lastDate = null, count = 0;
      if(fs.existsSync(dataDir)){
        const files = fs.readdirSync(dataDir)
          .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .sort();
        count = files.length;
        if(files.length > 0){
          firstDate = files[0].replace('.json','');
          lastDate  = files[files.length-1].replace('.json','');
        }
      }
      return {
        statusCode: 200,
        headers: { ...cors(), 'Content-Type':'application/json' },
        body: JSON.stringify({ firstDate, lastDate, count })
      };
    }

    // ── REALTIME: scarica XML ARPAV, estrae precipitazioni, restituisce JSON ──
    const res  = await fetch(XML_URL, { headers: { Accept: 'text/xml,application/xml' } });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml  = await res.text();

    const stations = parseARPAVXML(xml);

    return {
      statusCode: 200,
      headers: { ...cors(), 'Content-Type':'application/json', 'Cache-Control':'public, s-maxage=600' },
      body: JSON.stringify({ stations, count: stations.length })
    };

  } catch(error){
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: error.message }) };
  }
};

// ─── Parser XML ARPAV ────────────────────────────────────────────
function parseARPAVXML(xml) {
  const stations = [];

  // Estrae tutti i blocchi <STAZIONE>...</STAZIONE>
  const stazRegex = /<STAZIONE>([\s\S]*?)<\/STAZIONE>/g;
  let stazMatch;

  while ((stazMatch = stazRegex.exec(xml)) !== null) {
    const stazXml = stazMatch[1];

    // Dati stazione
    const id    = getTag(stazXml, 'IDSTAZ');
    const nome  = getCDATA(stazXml, 'NOME') || getTag(stazXml, 'NOME');
    const lon   = parseFloat(getTag(stazXml, 'X'));
    const lat   = parseFloat(getTag(stazXml, 'Y'));
    const quota = parseInt(getTag(stazXml, 'QUOTA')) || 0;
    const prov  = getTag(stazXml, 'PROVINCIA') || '—';

    if(!id || isNaN(lat) || isNaN(lon)) continue;
    // Filtra solo Veneto (bbox)
    if(lat < 44.7 || lat > 46.8 || lon < 10.6 || lon > 13.2) continue;

    // Cerca sensore PRECCUM (precipitazione cumulata)
    const sensoreRegex = /<SENSORE>([\s\S]*?)<\/SENSORE>/g;
    let sensMatch;
    let mmGiorno = 0;

    while ((sensMatch = sensoreRegex.exec(stazXml)) !== null) {
      const sensXml = sensMatch[1];
      const type    = getTag(sensXml, 'TYPE');
      if(type !== 'PRECCUM') continue;

      // Estrae tutti i valori e calcola max-min (cumulata giornaliera)
      const datiRegex = /<DATI ISTANTE="(\d{12})"><VM>([\d.]+)<\/VM><\/DATI>/g;
      let datiMatch;
      const vals = [];

      while ((datiMatch = datiRegex.exec(sensXml)) !== null) {
        const v = parseFloat(datiMatch[2]);
        if(!isNaN(v) && v >= 0) vals.push(v);
      }

      if(vals.length >= 2) {
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        mmGiorno  = Math.max(0, max - min);
        if(mmGiorno > 300) mmGiorno = 0;
      } else if(vals.length === 1) {
        mmGiorno = Math.max(0, vals[0]);
      }
      break; // prende solo il primo sensore PRECCUM
    }

    stations.push({
      id:    id,
      name:  nome,
      lat:   Math.round(lat * 10000) / 10000,
      lon:   Math.round(lon * 10000) / 10000,
      quota: quota,
      prov:  prov,
      mm:    Math.round(mmGiorno * 10) / 10
    });
  }

  return stations;
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
  return m ? m[1].trim() : null;
}

function getCDATA(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*?)\\]\\]><\/${tag}>`));
  return m ? m[1].trim() : null;
}

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}
