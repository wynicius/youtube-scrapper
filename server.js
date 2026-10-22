// Monitor de vídeos novos no YouTube — eleições 2026.
// Só leitura. Duas fontes:
//   1. canais.json  -> aba /videos de cada canal (página pública, sem chave, sem cota)
//   2. busca        -> YouTube Data API, termos de config.termosBusca (precisa de YOUTUBE_API_KEY)
// Mostra só vídeos publicados há menos de config.janelaMinutos. Não publica nem comenta nada.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { videosDoCanal } = require('./youtube-scrape');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'videos.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CATEGORIA_NOTICIAS = '25';

// ---------- config / env ----------

function carregarEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const linha of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv();

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const API_KEY = process.env.YOUTUBE_API_KEY;

function carregarCanais() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'canais.json'), 'utf8')); } catch { return []; }
}

const janelaMs = () => (config.janelaMinutos || 60) * 60e3;
const limiteJanela = () => Date.now() - janelaMs();

// ---------- estado ----------

let videos = new Map(); // id -> video
const estado = {
  canais: { ultima: null, erro: null, rodando: false, novos: 0, canaisComErro: [] },
  busca: { ultima: null, erro: null, rodando: false, novos: 0 },
};

function carregarDados() {
  try {
    const lista = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    videos = new Map(lista.map((v) => [v.id, v]));
    expirar();
    console.log(`[dados] ${videos.size} vídeos carregados`);
  } catch {
    videos = new Map();
  }
}

function salvarDados() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify([...videos.values()], null, 2));
}

function expirar() {
  const limite = limiteJanela();
  for (const [id, v] of videos) if (new Date(v.publicadoEm).getTime() < limite) videos.delete(id);
}

// ---------- utilidades ----------

const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Palavra inteira, sem acento e sem caixa: "PT" casa "PT atua…" mas não "pt-br" nem "opta".
const termosRe = () => new RegExp(`(^|[^a-z0-9-])(${(config.termosBusca || []).map((t) => escapeRe(semAcento(t))).join('|')})(?=$|[^a-z0-9-])`, 'i');
const bateTermos = (texto) => !config.termosBusca?.length || termosRe().test(semAcento(texto));
// Termos com espaço vão entre aspas na busca da API: Bolsonaro | Lula | "Flávio Bolsonaro"
const consultaBusca = () => (config.termosBusca || []).map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' | ');

function passaDuracao(seg) {
  if (seg == null) return true; // desconhecida: não descarta
  if (config.duracaoMinSegundos && seg < config.duracaoMinSegundos) return false;
  if (config.duracaoMaxSegundos && seg > config.duracaoMaxSegundos) return false;
  return true;
}

// "PT1H2M3S" -> segundos
function isoParaSegundos(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

async function mapLimitado(itens, limite, fn) {
  const fila = [...itens];
  const out = [];
  await Promise.all(Array.from({ length: Math.min(limite, fila.length) }, async () => {
    while (fila.length) out.push(await fn(fila.shift()));
  }));
  return out;
}

// ---------- YouTube Data API (só com chave) ----------

async function yt(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', API_KEY);
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(`YouTube API (${endpoint}): ${body?.error?.message || res.status}`);
  return body;
}

// Detalhes exatos (publishedAt, duração, views, comentários, categoria) — 1 unidade por 50 ids.
async function detalhes(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await yt('videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(',') });
    for (const it of data.items || []) out.set(it.id, it);
  }
  return out;
}

function aplicarDetalhes(v, it) {
  v.publicadoEm = it.snippet.publishedAt;
  v.publicadoEstimado = false;
  v.duracaoSegundos = isoParaSegundos(it.contentDetails?.duration);
  v.visualizacoes = +(it.statistics?.viewCount || 0);
  v.comentarios = +(it.statistics?.commentCount || 0);
  v.categoriaId = it.snippet.categoryId;
  v.aoVivo = it.snippet.liveBroadcastContent && it.snippet.liveBroadcastContent !== 'none';
  if (!v.canal) v.canal = it.snippet.channelTitle;
  if (!v.canalId) v.canalId = it.snippet.channelId;
  if (!v.titulo) v.titulo = it.snippet.title;
}

// ---------- fonte 1: canais (página /videos) ----------

async function coletarCanais() {
  const st = estado.canais;
  if (st.rodando) return;
  st.rodando = true;
  st.novos = 0;
  st.canaisComErro = [];
  try {
    const canais = carregarCanais();
    const candidatos = [];
    await mapLimitado(canais, 3, async (c) => {
      try {
        const { nome, videos: lista } = await videosDoCanal(c.id);
        for (const v of lista) {
          if (v.minutosAtras == null || v.minutosAtras > (config.janelaMinutos || 60)) continue;
          if (v.aoVivo) continue;
          if (config.canaisExigirTermos && !bateTermos(v.titulo)) continue;
          if (!passaDuracao(v.duracaoSegundos)) continue;
          candidatos.push({ ...v, canal: nome || c.nome, canalId: c.id });
        }
      } catch (e) {
        st.canaisComErro.push(`${c.nome || c.handle}: ${e.message}`);
      }
    });

    const novosIds = [];
    for (const v of candidatos) {
      const atual = videos.get(v.id);
      if (atual) { // já temos: só atualiza o que muda
        atual.visualizacoes = Math.max(atual.visualizacoes || 0, v.visualizacoes || 0);
        continue;
      }
      videos.set(v.id, {
        id: v.id,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        titulo: v.titulo,
        canal: v.canal,
        canalId: v.canalId,
        origem: 'canal',
        publicadoEm: v.publicadoEstimado,
        publicadoEstimado: true,
        publicadoTexto: v.publicadoTexto,
        duracaoSegundos: v.duracaoSegundos,
        visualizacoes: v.visualizacoes || 0,
        comentarios: null,
        thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
        captadoEm: new Date().toISOString(),
      });
      novosIds.push(v.id);
    }

    // refina com a API quando houver chave (barato: 1 unidade por 50 vídeos)
    if (API_KEY && novosIds.length) {
      try {
        const det = await detalhes(novosIds);
        for (const id of novosIds) {
          const v = videos.get(id); const it = det.get(id);
          if (!v || !it) continue;
          aplicarDetalhes(v, it);
          if (v.aoVivo || !passaDuracao(v.duracaoSegundos)) videos.delete(id);
        }
      } catch (e) {
        console.error(`[canais] detalhes: ${e.message}`);
      }
    }

    expirar();
    st.novos = novosIds.filter((id) => videos.has(id)).length;
    st.ultima = new Date().toISOString();
    st.erro = st.canaisComErro.length === canais.length && canais.length ? 'todos os canais falharam' : null;
    salvarDados();
    console.log(`[canais] ${canais.length} canais, ${st.novos} novos, ${videos.size} na janela` +
      (st.canaisComErro.length ? `, ${st.canaisComErro.length} com erro` : ''));
  } catch (e) {
    st.erro = e.message;
    console.error(`[canais] ${e.message}`);
  } finally {
    st.rodando = false;
  }
}

// ---------- fonte 2: busca por termos (API) ----------

async function coletarBusca() {
  const st = estado.busca;
  if (!API_KEY) { st.erro = 'sem YOUTUBE_API_KEY: busca por termos desligada (os canais continuam)'; return; }
  if (st.rodando || !config.termosBusca?.length) return;
  st.rodando = true;
  st.novos = 0;
  try {
    const q = consultaBusca();
    const data = await yt('search', {
      part: 'id', type: 'video', q, order: 'date',
      publishedAfter: new Date(limiteJanela()).toISOString(),
      maxResults: '50', regionCode: config.regiao || 'BR', relevanceLanguage: config.idioma || 'pt', safeSearch: 'none',
    });
    const ids = (data.items || []).map((i) => i.id.videoId).filter((id) => id && !videos.has(id));
    if (ids.length) {
      const det = await detalhes(ids);
      for (const [id, it] of det) {
        const v = { id, url: `https://www.youtube.com/watch?v=${id}`, origem: 'busca', termo: q,
          thumb: it.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          captadoEm: new Date().toISOString() };
        aplicarDetalhes(v, it);
        if (v.aoVivo || !passaDuracao(v.duracaoSegundos)) continue;
        if (config.buscaSomenteNoticias && v.categoriaId !== CATEGORIA_NOTICIAS) continue;
        if (new Date(v.publicadoEm).getTime() < limiteJanela()) continue;
        // a busca do YouTube é frouxa; exige o termo de fato no título ou na descrição
        if (!bateTermos(`${v.titulo}\n${it.snippet.description || ''}`)) continue;
        videos.set(id, v);
        st.novos++;
      }
    }
    expirar();
    st.ultima = new Date().toISOString();
    st.erro = null;
    salvarDados();
    console.log(`[busca] "${q}": ${st.novos} novos, ${videos.size} na janela`);
  } catch (e) {
    st.erro = e.message;
    console.error(`[busca] ${e.message}`);
  } finally {
    st.rodando = false;
  }
}

// ---------- HTTP ----------

function listaOrdenada() {
  expirar();
  return [...videos.values()].sort((a, b) => new Date(b.publicadoEm) - new Date(a.publicadoEm));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body, null, 2));
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/videos') return json(res, 200, listaOrdenada());

  // Array simples com as URLs dos vídeos na janela (mais novo primeiro). ?origem=canal|busca filtra.
  if (url.pathname === '/api/links') {
    const origem = url.searchParams.get('origem');
    return json(res, 200, listaOrdenada().filter((v) => !origem || v.origem === origem).map((v) => v.url));
  }

  if (url.pathname === '/api/canais') return json(res, 200, carregarCanais());

  if (url.pathname === '/api/status') {
    return json(res, 200, { ...estado, total: videos.size, temChave: !!API_KEY, canais: { ...estado.canais, quantidade: carregarCanais().length }, config });
  }

  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    await Promise.all([coletarCanais(), coletarBusca()]);
    return json(res, 200, { ...estado, total: videos.size });
  }

  const arquivo = url.pathname === '/' ? '/index.html' : url.pathname;
  const caminho = path.join(PUBLIC_DIR, path.normalize(arquivo));
  if (caminho.startsWith(PUBLIC_DIR) && fs.existsSync(caminho) && fs.statSync(caminho).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(caminho)] || 'application/octet-stream' });
    return fs.createReadStream(caminho).pipe(res);
  }
  res.writeHead(404);
  res.end('não encontrado');
});

carregarDados();
server.listen(config.port, () => {
  console.log(`Painel:  http://localhost:${config.port}`);
  console.log(`Links:   http://localhost:${config.port}/api/links`);
  console.log(`Canais:  ${carregarCanais().length} (canais.json)`);
  if (!API_KEY) console.warn('AVISO: sem YOUTUBE_API_KEY — só os canais serão monitorados; a busca por termos precisa da chave (.env).');
  coletarCanais();
  coletarBusca();
  setInterval(coletarCanais, (config.intervaloCanaisMinutos || 5) * 60e3);
  setInterval(coletarBusca, (config.intervaloBuscaMinutos || 15) * 60e3);
});
