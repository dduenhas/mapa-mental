const MAX_NODES = 100;
const MAX_TEXT_LENGTH = 120;
const MAX_TITLE_LENGTH = 80;
const ID_PATTERN = /^[a-z0-9_-]{4,64}$/i;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function validateMapPayload(body, expectedId) {
  if (!body || typeof body !== 'object') {
    return 'Corpo da requisição inválido';
  }

  if (body.id && body.id !== expectedId) {
    return 'ID do mapa não corresponde à URL';
  }

  if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
    return 'O mapa precisa ter ao menos um tópico';
  }

  if (body.nodes.length > MAX_NODES) {
    return `Limite de ${MAX_NODES} tópicos por mapa`;
  }

  if (body.title && String(body.title).length > MAX_TITLE_LENGTH) {
    return `Título deve ter no máximo ${MAX_TITLE_LENGTH} caracteres`;
  }

  const ids = new Set();
  let rootCount = 0;

  for (const node of body.nodes) {
    if (!node || typeof node !== 'object') {
      return 'Formato de tópico inválido';
    }

    if (!node.id || typeof node.id !== 'string') {
      return 'Cada tópico precisa de um identificador';
    }

    if (ids.has(node.id)) {
      return 'Identificadores de tópicos duplicados';
    }
    ids.add(node.id);

    const text = String(node.text ?? '').trim();
    if (text.length > MAX_TEXT_LENGTH) {
      return `Texto do tópico excede ${MAX_TEXT_LENGTH} caracteres`;
    }

    if (typeof node.x !== 'number' || typeof node.y !== 'number') {
      return 'Posição inválida em um tópico';
    }

    if (!node.color || typeof node.color !== 'string') {
      return 'Cor inválida em um tópico';
    }

    if (node.parentId === null) {
      rootCount += 1;
    } else if (!node.parentId || !ids.has(node.parentId) && !body.nodes.some((n) => n.id === node.parentId)) {
      // parent may appear later in array — defer strict parent check
    }
  }

  if (rootCount !== 1) {
    return 'O mapa deve ter exatamente um tópico central';
  }

  for (const node of body.nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      return 'Tópico com referência de pai inválida';
    }
  }

  return null;
}

function sanitizeMap(body, id) {
  return {
    id,
    title: String(body.title || 'Nova Pesquisa').trim().slice(0, MAX_TITLE_LENGTH) || 'Nova Pesquisa',
    nodes: body.nodes.map((node) => ({
      id: String(node.id),
      text: String(node.text ?? '?').trim().slice(0, MAX_TEXT_LENGTH) || '?',
      x: Number(node.x),
      y: Number(node.y),
      color: String(node.color).slice(0, 32),
      parentId: node.parentId === null ? null : String(node.parentId)
    })),
    createdAt: body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function handleMapsApi(request, env, id) {
  const key = `map:${id}`;

  switch (request.method) {
    case 'GET': {
      const value = await env.MINDMAPS.get(key, 'json');
      if (!value) {
        return jsonResponse({ error: 'Mapa não encontrado' }, 404);
      }
      return jsonResponse(value);
    }

    case 'PUT': {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'JSON inválido' }, 400);
      }

      const validationError = validateMapPayload(body, id);
      if (validationError) {
        return jsonResponse({ error: validationError }, 400);
      }

      const map = sanitizeMap(body, id);
      await env.MINDMAPS.put(key, JSON.stringify(map));
      return jsonResponse({ ok: true, id });
    }

    case 'DELETE': {
      await env.MINDMAPS.delete(key);
      return jsonResponse({ ok: true });
    }

    default:
      return jsonResponse({ error: 'Método não permitido' }, 405, {
        Allow: 'GET, PUT, DELETE'
      });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/maps/')) {
      const id = path.slice('/api/maps/'.length);
      if (!ID_PATTERN.test(id)) {
        return jsonResponse({ error: 'ID inválido' }, 400);
      }

      try {
        return await handleMapsApi(request, env, id);
      } catch {
        return jsonResponse({ error: 'Erro interno' }, 500);
      }
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        return assetResponse;
      }

      if (request.method === 'GET' && !path.startsWith('/api/')) {
        const indexRequest = new Request(new URL('/index.html', url.origin), request);
        return env.ASSETS.fetch(indexRequest);
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
