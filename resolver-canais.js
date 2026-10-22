// Resolve handles (@nome) de canais.json para IDs (UC...) e confere o nome real.
// Não usa cota da API: lê a página pública do canal.
// Uso: node resolver-canais.js            -> resolve os que ainda não têm id
//      node resolver-canais.js @handle... -> adiciona esses handles e resolve

const fs = require('node:fs');
const path = require('node:path');
const { resolverHandle } = require('./youtube-scrape');

const ARQ = path.join(__dirname, 'canais.json');

(async () => {
  let canais = [];
  try { canais = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch {}
  for (const h of process.argv.slice(2)) {
    const handle = h.replace(/^@/, '');
    if (!canais.some((c) => c.handle?.toLowerCase() === handle.toLowerCase())) canais.push({ handle });
  }

  const ok = [];
  for (const c of canais) {
    if (c.id) { ok.push(c); continue; }
    try {
      const { id, nome, inscritos } = await resolverHandle(c.handle);
      ok.push({ handle: c.handle, id, nome, inscritos });
      console.log(`✓ @${c.handle.padEnd(26)} ${id}  ${nome}  (${inscritos})`);
    } catch (e) {
      console.log(`✗ @${c.handle}: ${e.message}`);
    }
  }
  fs.writeFileSync(ARQ, JSON.stringify(ok, null, 2));
  console.log(`\n${ok.length} canais em canais.json`);
})();
