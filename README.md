# youtube-scrapper · Monitor de vídeos novos · Eleições 2026

Servidor local, só leitura, que lista vídeos do YouTube **publicados há menos de 1 hora**
sobre as eleições de 2026, num painel com link direto. Não comenta, não publica, não
toca na sua conta.

Duas fontes:

1. **Canais monitorados** (`canais.json`): lê a aba `/videos` de cada canal (página
   pública). Não precisa de chave nem gasta cota. Lista com 27 canais de direita/
   liberais já resolvida (Jovem Pan News, Os Pingos nos Is, Brasil Paralelo, Oeste,
   Gazeta do Povo, O Antagonista, Flávio Bolsonaro, Bolsonaro TV, MBL, NOVO, PL…).
   Todo vídeo novo desses canais entra.
2. **Busca por termos** (`termosBusca`, padrão `Bolsonaro | Lula | PT | PL | "Flávio Bolsonaro"`):
   YouTube Data API, precisa de `YOUTUBE_API_KEY`. Filtra pela categoria "Notícias e
   política" e exige o termo (palavra inteira) no título ou na descrição.

Instruções passo a passo para obter o array de links estão em [PROMPT.md](PROMPT.md).

## Rodar

```bash
node server.js
```

Abra <http://localhost:3777>. Funciona sem chave (só os canais). Para ligar a busca por
termos, crie uma chave da **YouTube Data API v3** no Google Cloud Console, copie
`.env.example` para `.env` e cole a chave. Com a chave, os vídeos dos canais também
ganham horário exato, duração e contagem de comentários (sem ela, o horário é o
"há N min" da página, marcado com `~` no painel).

Sem dependências: Node 18+ basta.

## Endpoints

| Rota | O que devolve |
|---|---|
| `GET /api/links` | **array simples de URLs** (mais novo primeiro). `?origem=canal` ou `?origem=busca` filtra. |
| `GET /api/videos` | lista completa (título, canal, origem, horário, duração, views…) |
| `GET /api/canais` | canais monitorados |
| `GET /api/status` | última coleta de cada fonte, erros, config |
| `POST /api/refresh` | força uma coleta agora (as duas fontes) |

```bash
curl -s http://localhost:3777/api/links
```

## Canais

Para adicionar canais, passe os handles ao resolver (ele confere o nome e os inscritos
para você ver se pegou o canal certo e não um homônimo):

```bash
node resolver-canais.js @JovemPanNews @OutroCanal
```

Para remover, apague a entrada em `canais.json`.

## Configuração (`config.json`)

- `janelaMinutos` (60): só mostra vídeos publicados há menos que isso.
- `intervaloCanaisMinutos` (5) e `intervaloBuscaMinutos` (15): frequência de cada fonte.
  A busca custa 100 unidades da cota (10.000/dia grátis); a cada 15 min ≈ 9.600/dia.
- `termosBusca`: termos da busca na API; viram `A | B | "C D"` (ou).
- `canaisExigirTermos` (false): se `true`, vídeos dos canais só entram se o título
  tiver um dos termos.
- `buscaSomenteNoticias` (true): resultados da busca só na categoria Notícias e política.
- `duracaoMinSegundos` (60, tira Shorts) / `duracaoMaxSegundos` (0 = sem limite).

Os vídeos ficam em `data/videos.json` e saem da lista sozinhos quando passam da janela.
