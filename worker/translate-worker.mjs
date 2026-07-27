const DEFAULT_ORIGINS = [
  'https://hahha114157-ctrl.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173'
];

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
    .split(',').map(value => value.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) }
  });
}

async function translateWithDeepL(input, env) {
  if (!env.DEEPL_API_KEY) throw new Error('DEEPL_API_KEY is not configured');
  const endpoint = env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';
  const body = new URLSearchParams({
    text: input.text,
    source_lang: 'EN',
    target_lang: !input.target || input.target === 'zh' ? 'ZH-HANS' : input.target.toUpperCase()
  });
  if (input.context) body.set('context', input.context.slice(0, 1000));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `DeepL HTTP ${response.status}`);
  const translation = data.translations?.[0];
  return { translation: translation?.text, alternatives: [], detectedLanguage: translation?.detected_source_language, provider: 'DeepL' };
}

async function translateWithLibre(input, env) {
  if (!env.LIBRETRANSLATE_URL) throw new Error('LIBRETRANSLATE_URL is not configured');
  const endpoint = new URL('/translate', env.LIBRETRANSLATE_URL).href;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: input.context && input.text.split(/\s+/).length <= 4 ? `${input.context}\n\n${input.text}` : input.text,
      source: input.source || 'en',
      target: input.target || 'zh',
      alternatives: Math.min(3, Number(input.alternatives || 0)),
      api_key: env.LIBRETRANSLATE_API_KEY || undefined
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `LibreTranslate HTTP ${response.status}`);
  return {
    translation: Array.isArray(data.translatedText) ? data.translatedText.at(-1) : data.translatedText,
    alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
    detectedLanguage: data.detectedLanguage?.language || data.detectedLanguage,
    provider: 'LibreTranslate'
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/health')) {
      return json(request, env, { ok: true, provider: env.TRANSLATION_PROVIDER || (env.DEEPL_API_KEY ? 'deepl' : 'libretranslate') });
    }
    if (request.method !== 'POST' || !url.pathname.endsWith('/translate')) return json(request, env, { error: 'Not found' }, 404);

    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(value => value.trim());
    if (origin && !allowed.includes(origin)) return json(request, env, { error: 'Origin is not allowed' }, 403);

    const input = await request.json().catch(() => null);
    if (!input || typeof input.text !== 'string') return json(request, env, { error: 'text is required' }, 400);
    input.text = input.text.replace(/\s+/g, ' ').trim();
    input.context = String(input.context || '').replace(/\s+/g, ' ').trim();
    if (!input.text || input.text.length > 2000) return json(request, env, { error: 'text must contain 1–2000 characters' }, 400);

    try {
      const provider = String(env.TRANSLATION_PROVIDER || (env.DEEPL_API_KEY ? 'deepl' : 'libretranslate')).toLowerCase();
      const result = provider === 'deepl' ? await translateWithDeepL(input, env) : await translateWithLibre(input, env);
      if (!result.translation) throw new Error('Translation provider returned an empty result');
      return json(request, env, result);
    } catch (error) {
      return json(request, env, { error: error.message || 'Translation failed' }, 502);
    }
  }
};
