/**
 * collect-veneto.js - TEST versione
 * Legge stazioni.xml da meteo.arpa.veneto.it e stampa la struttura
 */
const https = require('https');
const zlib  = require('zlib');

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept-Encoding': 'gzip, deflate', 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        if (enc === 'gzip') {
          zlib.gunzip(buf, (e, d) => e ? reject(e) : resolve(d.toString('utf8')));
        } else if (enc === 'deflate') {
          zlib.inflate(buf, (e, d) => e ? reject(e) : resolve(d.toString('utf8')));
        } else {
          // prova comunque a gunzip
          zlib.gunzip(buf, (e, d) => {
            if (e) resolve(buf.toString('utf8'));
            else resolve(d.toString('utf8'));
          });
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Scarico stazioni.xml...');
  const xml = await fetchURL('https://meteo.arpa.veneto.it/meteo/dati_meteo/xml/stazioni.xml');
  console.log('Primi 2000 caratteri:');
  console.log(xml.substring(0, 2000));

  console.log('\n\nScarico 0234.xml (Padova)...');
  const xml2 = await fetchURL('https://meteo.arpa.veneto.it/meteo/dati_meteo/xml/0234.xml');
  console.log('Primi 2000 caratteri:');
  console.log(xml2.substring(0, 2000));
}

main().catch(e => { console.error('Errore:', e); process.exit(1); });
