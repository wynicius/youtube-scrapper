// Leitura das páginas públicas do YouTube (sem chave, sem cota).
// - resolverHandle('@nome') -> { id, nome }
// - videosDoCanal('UC...')   -> { nome, videos: [...] } com os ~30 vídeos mais recentes da aba /videos

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HEADERS = { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9', cookie: 'PREF=hl=pt&gl=BR; CONSENT=YES+1' };

async function pagina(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

function ytInitialData(html) {
  const m = /var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s.exec(html);
  if (!m) throw new Error('ytInitialData não encontrado');
  return JSON.parse(m[1]);
}

// Percorre o JSON e devolve todos os objetos que tenham a chave pedida.
function* achar(obj, chave) {
  if (!obj || typeof obj !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(obj, chave)) yield obj[chave];
  for (const v of Object.values(obj)) yield* achar(v, chave);
}

// "há 3 min." | "há 1 h" | "há 2 dias" | "Transmitido há 1 sem." -> minutos atrás (aprox.)
const UNIDADES = [
  [/^s|^seg/, 1 / 60], [/^min/, 1], [/^h/, 60], [/^d/, 1440], [/^sem/, 10080], [/^m[eê]s/, 43200], [/^a/, 525600],
];
function textoParaMinutos(txt) {
  const m = /há\s+(\d+)\s*([a-zç]+)/i.exec((txt || '').normalize('NFC'));
  if (!m) return null;
  const u = m[2].toLowerCase();
  // ordem importa: "sem" antes de "s", "min" antes de "m"
  const fator = u.startsWith('sem') ? 10080 : u.startsWith('min') ? 1 : u.startsWith('m') ? 43200
    : UNIDADES.find(([re]) => re.test(u))?.[1];
  return fator == null ? null : +m[1] * fator;
}

// "12:34" | "1:02:03" -> segundos
function textoParaSegundos(txt) {
  if (!/^\d+(:\d+){1,2}$/.test(txt || '')) return null;
  return txt.split(':').reduce((acc, p) => acc * 60 + +p, 0);
}

// "5,3 mil" | "345" | "2,1 mi" -> número
const RE_VIEWS = /^\s*([\d.,]+)\s*(mil|mi)?\s*(visualiza\S*)?\s*$/i;
function textoParaViews(txt) {
  const m = RE_VIEWS.exec((txt || '').replace(/\.(?=\d{3})/g, ''));
  if (!m) return 0;
  let n = parseFloat(m[1].replace(',', '.'));
  if (/mil/i.test(m[2] || '')) n *= 1e3;
  if (/^mi$/i.test(m[2] || '')) n *= 1e6;
  return Math.round(n);
}

async function resolverHandle(handle) {
  const h = handle.replace(/^@/, '');
  const html = await pagina(`https://www.youtube.com/@${encodeURIComponent(h)}`);
  const id = /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) throw new Error(`canal @${h} sem externalId`);
  const nome = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] || h;
  const inscritos = /"([\d.,]+\s*(?:mil|mi)?\s*(?:de\s+)?inscritos)"/i.exec(html)?.[1] || '?';
  return { id, nome: decodeHtml(nome), inscritos };
}

function decodeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function videosDoCanal(id) {
  const html = await pagina(`https://www.youtube.com/channel/${id}/videos`);
  const data = ytInitialData(html);
  const nome = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] || id;
  const videos = [];
  const vistos = new Set();

  for (const lockup of achar(data, 'lockupViewModel')) {
    if (lockup?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !lockup.contentId) continue;
    const vid = lockup.contentId;
    if (vistos.has(vid)) continue;
    vistos.add(vid);

    const meta = lockup.metadata?.lockupMetadataViewModel;
    const titulo = meta?.title?.content || '';
    const partes = [];
    for (const row of meta?.metadata?.contentMetadataViewModel?.metadataRows || []) {
      for (const p of row.metadataParts || []) if (p.text?.content) partes.push(p.text.content);
    }
    const txtTempo = partes.find((t) => /há\s+\d+/i.test(t)) || '';
    const txtViews = partes.find((t) => RE_VIEWS.test(t)) || '';
    const aoVivo = partes.some((t) => /ao vivo|assistindo agora/i.test(t));

    let duracao = null;
    for (const badge of achar(lockup.contentImage, 'thumbnailBadgeViewModel')) {
      const s = textoParaSegundos(badge?.text);
      if (s != null) { duracao = s; break; }
    }

    const minAtras = textoParaMinutos(txtTempo);
    videos.push({
      id: vid,
      titulo,
      publicadoTexto: txtTempo,
      // estimativa: a página só diz "há N minutos/horas"; a API refina depois, se houver chave
      publicadoEstimado: minAtras == null ? null : new Date(Date.now() - minAtras * 60e3).toISOString(),
      minutosAtras: minAtras,
      duracaoSegundos: duracao,
      visualizacoes: textoParaViews(txtViews),
      aoVivo,
    });
  }
  return { nome: decodeHtml(nome), videos };
}

module.exports = { resolverHandle, videosDoCanal, textoParaMinutos };
