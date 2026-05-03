exports.handler = async function(event) {
  const params = event.queryStringParameters || {};
  const endpoint = params.endpoint || 'nf78-nj6b.json';

  const qs = Object.entries(params)
    .filter(([k]) => k !== 'endpoint')
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const arpaUrl = `https://www.dati.lombardia.it/resource/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const response = await fetch(arpaUrl, {
      headers: { 'Accept': 'application/json' }
    });
    const data = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Cache CDN Netlify: 1 ora per misure, 5 min per stazioni
        'Cache-Control': endpoint === 'pstb-pga6.json'
          ? 'public, s-maxage=3600, stale-while-revalidate=300'
          : 'public, s-maxage=300'
      },
      body: data
    };
  } catch(error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
