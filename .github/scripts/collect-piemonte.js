/**
 * Test API ARPA Piemonte - trova gli endpoint corretti
 */
async function test(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    console.log(`\n[${r.status}] ${url}`);
    console.log(text.substring(0, 300));
  } catch(e) {
    console.log(`\n[ERR] ${url} → ${e.message}`);
  }
}

async function main() {
  const base = 'https://utility.arpa.piemonte.it/api_realtime';
  await test(`${base}/`);
  await test(`${base}/stazioni/`);
  await test(`${base}/stazioni`);
  await test(`${base}/misure/`);
  await test(`${base}/sensori/`);
  await test(`${base}/precipitazioni/`);
  await test(`${base}/v1/stazioni/`);
  await test(`${base}/v1/misure/`);
}

main();
