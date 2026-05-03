async function test(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    console.log(`[${r.status}] ${url}`);
    console.log(text.substring(0, 400));
    console.log('---');
  } catch(e) {
    console.log(`[ERR] ${url} → ${e.message}`);
  }
}

async function main() {
  const base = 'https://utility.arpa.piemonte.it/api_realtime';
  await test(`${base}/openapi.json`);
  await test(`${base}/redoc`);
  await test(`${base}/docs`);
  await test(`${base}/api/stazioni/`);
  await test(`${base}/api/misure/`);
  await test(`${base}/realtime/stazioni/`);
  await test(`${base}/realtime/misure/`);
  await test(`${base}/data/stazioni/`);
  await test(`${base}/pioggia/`);
  await test(`${base}/precipitazione/`);
}

main();
