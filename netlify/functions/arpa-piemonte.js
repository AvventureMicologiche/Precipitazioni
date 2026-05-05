const fs   = require('fs');
const path = require('path');

const API_BASE = 'https://utility.arpa.piemonte.it/api_realtime';

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const type   = params.type || 'anag';

  try {

    // ── STORICO: serve file JSON dal repo data/piemonte/YYYY-MM-DD.json ──
    if(type === 'storico'){
      const date = params.date;
      if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
        return { statusCode: 400, headers: cors(), body: JSON.stringify({error:'date param required'}) };
      }
      const filePath = path.join(__dirname, '..', '..', 'data', 'piemonte', `${date}.json`);
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

    // ── INFO: prima e ultima data disponibile nel database ──
    if(type === 'info'){
      const dataDir = path.join(__dirname, '..', '..', 'data', 'piemonte');
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

    // ── ANAGRAFICA stazioni ──
    if(type === 'anag'){
      const res  = await fetch(`${API_BASE}/pie_anag?page_size=10000`, { headers:{Accept:'application/json'} });
      const data = await res.text();
      return {
        statusCode: res.status,
        headers: { ...cors(), 'Content-Type':'application/json', 'Cache-Control':'public, s-maxage=3600' },
        body: data
      };
    }

    // ── DATI precipitazione (realtime) ──
    if(type === 'data_pie'){
      const dateFrom = params.date_from || '';
      const dateTo   = params.date_to   || '';
      const page     = params.page      || '1';
      // I parametri arrivano già decodificati da Netlify — li passiamo direttamente
      const url = `${API_BASE}/data_pie?date_from=${dateFrom}&date_to=${dateTo}&page=${page}&page_size=10000`;
      console.log('[PIE proxy] url:', url);
      const res  = await fetch(url, { headers:{Accept:'application/json'} });
      const data = await res.text();
      console.log('[PIE proxy] status:', res.status, 'body length:', data.length);
      return {
        statusCode: res.status,
        headers: { ...cors(), 'Content-Type':'application/json', 'Cache-Control':'public, s-maxage=300' },
        body: data
      };
    }

    return { statusCode: 400, headers: cors(), body: JSON.stringify({error:'unknown type: '+type}) };

  } catch(error){
    return { statusCode: 500, headers: cors(), body: JSON.stringify({error: error.message}) };
  }
};

function cors(){
  return { 'Access-Control-Allow-Origin': '*' };
}
