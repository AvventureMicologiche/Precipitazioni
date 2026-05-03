async function main() {
  const r = await fetch('https://utility.arpa.piemonte.it/api_realtime/openapi.json');
  const api = await r.json();
  console.log('=== PATHS ===');
  Object.keys(api.paths).forEach(p => {
    const methods = Object.keys(api.paths[p]);
    console.log(p, '-', methods.join(','));
  });
  console.log('\n=== FULL JSON ===');
  console.log(JSON.stringify(api.paths, null, 2).substring(0, 3000));
}
main();
