const fs = require('fs');
const path = require('path');

exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const type = params.type || 'realtime'; // 'realtime' | 'storico' | 'stazioni'

  try {

    // ── STORICO: serve file JSON dal repo data/piemonte/YYYY-MM-DD.json ──
    if (type === 'storico') {
      const date = params.date; // YYYY-MM-DD
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'date param required (YYYY-MM-DD)' }) };
      }
      const filePath = path.join(__dirname, '..', '..', 'data', 'piemonte', `${date}.json`);
      if (!fs.existsSync(filePath)) {
        return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'no data', date }) };
      }
      const data = fs.readFileSync(filePath, 'utf8');
      return {
        statusCode: 200,
        headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=86400' },
        body: data
      };
    }

    // ── INFO: ritorna la data del primo giorno disponibile nel database ──
    if (type === 'info') {
      const dataDir = path.join(__dirname, '..', '..', 'data', 'piemonte');
      let firstDate = null;
      let lastDate = null;
      let count = 0;
      if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir)
          .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .sort();
        count = files.length;
        if (files.length > 0) {
          firstDate = files[0].replace('.json', '');
          lastDate = files[files.length - 1].replace('.json', '');
        }
      }
      return {
        statusCode: 200,
        headers: { ...cors(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstDate, lastDate, count })
      };
    }

    // ── REALTIME: proxy verso API ARPA Piemonte ──
    // endpoint: stazioni o misure
    const apiBase = 'https://utility.arpa.piemonte.it/api_realtime';
    let url;

    if (type === 'stazioni') {
      // Lista stazioni pluviometriche
      url = `${apiBase}/stazioni/?id_sensore_type=PREC&format=json`;
    } else {
      // Misure precipitazione ultime N ore (default 24h)
      const ore = parseInt(params.ore) || 24;
      url = `${apiBase}/misure/?id_sensore_type=PREC&ore=${ore}&format=json`;
    }

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    const data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        ...cors(),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300'
      },
      body: data
    };

  } catch(error) {
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: error.message })
    };
  }
};

function cors() {
  return { 'Access-Control-Allow-Origin': '*' };
}
