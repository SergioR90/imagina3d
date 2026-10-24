/**
 * Imagina3D — Proxy MakerWorld (Cloudflare Worker, plano gratuito)
 *
 * Porquê: o MakerWorld não envia cabeçalhos CORS, por isso o browser não pode ler
 * a API diretamente a partir do GitHub Pages. Este Worker faz o pedido do lado do
 * servidor e devolve o JSON com CORS, permitindo importar com 1 clique (também no telemóvel).
 *
 * Segurança: NÃO é um proxy aberto — só aceita um ID numérico e só contacta o
 * endpoint público de modelos do MakerWorld. Origens permitidas configuráveis abaixo.
 *
 * Instalação (5 min): ver cloudflare-worker/README.md
 */

const ALLOWED_ORIGINS = [
  'https://sergior90.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];
const MAKERWORLD_API = 'https://makerworld.com/api/v1/design-service/design/';
const CACHE_SECONDS = 3600;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.netlify.app');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return jsonResponse({ success: false, error: 'Método não suportado.' }, 405, origin);
    }

    const id = new URL(request.url).searchParams.get('id') || '';
    if (!/^\d{1,12}$/.test(id)) {
      return jsonResponse({ success: false, error: 'Parâmetro "id" inválido.' }, 400, origin);
    }

    try {
      const upstream = await fetch(MAKERWORLD_API + id, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Imagina3D quote importer)'
        },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
      });
      if (!upstream.ok) {
        return jsonResponse({ success: false, error: `MakerWorld respondeu ${upstream.status}.` }, 502, origin);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders(origin),
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`
        }
      });
    } catch (err) {
      return jsonResponse({ success: false, error: 'Falha ao contactar o MakerWorld.' }, 502, origin);
    }
  }
};
