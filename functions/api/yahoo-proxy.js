// Cloudflare Pages Function: 株価データ取得プロキシ
// 優先順位: 1. Yahoo Finance (crumb認証) → 2. Stooq CSV
// エンドポイント: /api/yahoo-proxy?symbols=9029.T,9057.T,...

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

const ANNUAL_DIVIDENDS = {
  '9029':  50, '9057':  96, '9069':  50, '9072':  74,
  '7267':  70, '7272':  50, '8630': 150, '8725': 155, '8766': 211,
};

async function fetchYahoo(symbols) {
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
  });
  if (!crumbRes.ok) throw new Error(`crumb: ${crumbRes.status}`);
  const crumb  = (await crumbRes.text()).trim();
  const cookie = crumbRes.headers.get('set-cookie') ?? '';
  if (!crumb || crumb.length > 30) throw new Error('invalid crumb');

  const fields = 'regularMarketPrice,trailingAnnualDividendYield,regularMarketChangePercent';
  const url    = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=${fields}&crumb=${encodeURIComponent(crumb)}`;
  const res    = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie } });
  if (!res.ok) throw new Error(`quote: ${res.status}`);
  const data = await res.json();
  if (!data?.quoteResponse?.result?.length) throw new Error('empty');
  return { ...data, source: 'yahoo' };
}

async function fetchStooq(symbols) {
  const s   = symbols.split(',').map(x => x.replace('.T', '.jp')).join(',');
  const res = await fetch(`https://stooq.com/q/l/?s=${s}&f=sd2t2ohlcv&e=csv`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`stooq: ${res.status}`);
  const csv    = await res.text();
  const lines  = csv.trim().split('\n');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols  = lines[i].split(',');
    if (cols.length < 7) continue;
    const code  = cols[0].replace(/\.(jp|JP)$/i, '').toUpperCase();
    const price = parseFloat(cols[6]);
    if (isNaN(price) || price <= 0) continue;
    const annDiv = ANNUAL_DIVIDENDS[code] ?? 0;
    result.push({
      symbol: `${code}.T`,
      regularMarketPrice: price,
      trailingAnnualDividendYield: annDiv > 0 ? annDiv / price : null,
      regularMarketChangePercent: 0,
    });
  }
  if (!result.length) throw new Error('stooq: no data');
  return { quoteResponse: { result, error: null }, source: 'stooq' };
}

export async function onRequestGet(context) {
  const url     = new URL(context.request.url);
  const symbols = url.searchParams.get('symbols');

  if (!symbols) {
    return new Response(JSON.stringify({ error: 'symbols required' }), {
      status: 400, headers: CORS_HEADERS,
    });
  }

  // 1. Yahoo Finance
  try {
    const data = await fetchYahoo(symbols);
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) { console.warn('Yahoo:', e.message); }

  // 2. Stooq
  try {
    const data = await fetchStooq(symbols);
    return new Response(JSON.stringify(data), {
      headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
  } catch (e) { console.error('Stooq:', e.message); }

  return new Response(JSON.stringify({ error: 'all sources failed' }), {
    status: 502, headers: CORS_HEADERS,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
