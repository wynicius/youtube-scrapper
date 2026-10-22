# Prompt: como obter o array de links dos vídeos novos

Use este texto como instrução para uma pessoa ou para um agente de IA que precise
operar o monitor. Ele descreve o que a aplicação faz, como rodar e como obter o
array de links. A aplicação é **só leitura**: ela não comenta, não publica e não
usa a conta do YouTube de ninguém.

---

## O que é

Um servidor Node local (`server.js`, sem dependências, Node 18+) que lista vídeos
do YouTube **publicados há menos de 60 minutos** relacionados às eleições de 2026
e expõe um array com os links. Duas fontes alimentam a lista:

1. **Canais monitorados** (`canais.json`): canais de direita/liberais já identificados
   e guardados para escaneamento (Jovem Pan News, Os Pingos nos Is, Brasil Paralelo,
   Revista Oeste, Gazeta do Povo, O Antagonista, Flávio Bolsonaro, Bolsonaro TV, MBL,
   NOVO, PL etc.). O servidor lê a aba `/videos` de cada um a cada 5 minutos, sem chave
   e sem cota. **Todo vídeo novo desses canais entra**, independentemente do título.
2. **Busca por termos** (`termosBusca` em `config.json`): `Bolsonaro`, `Lula`, `PT`,
   `PL`, `"Flávio Bolsonaro"`. Usa a YouTube Data API v3 (precisa de
   `YOUTUBE_API_KEY` no arquivo `.env`), só na categoria "Notícias e política", e exige
   que o termo apareça de fato no título ou na descrição (palavra inteira: `PT` casa
   "PT atua…", não casa "opta"). Roda a cada 15 minutos.

Regras comuns às duas fontes: só vídeos publicados há menos de `janelaMinutos` (60),
sem lives, sem Shorts (duração mínima 60 s). O vídeo sai da lista sozinho quando
passa da janela.

## Como rodar

```bash
node server.js
```

Painel em <http://localhost:3777>. Funciona sem chave (só os canais). Para ligar a
busca por termos: copie `.env.example` para `.env` e preencha `YOUTUBE_API_KEY`
(Google Cloud Console → ativar "YouTube Data API v3" → Credenciais → Chave de API).
Com a chave, os vídeos dos canais também ganham horário exato e contagem de comentários.

## Como obter o array de links

Três formas, todas devolvem o mesmo array de URLs, do mais novo para o mais antigo:

1. **API (para scripts e agentes):**

   ```bash
   curl -s http://localhost:3777/api/links
   ```

   Resposta:

   ```json
   [
     "https://www.youtube.com/watch?v=AAAAAAAAAAA",
     "https://www.youtube.com/watch?v=BBBBBBBBBBB"
   ]
   ```

   Filtros: `?origem=canal` (só canais monitorados) ou `?origem=busca` (só busca por
   termos). Para os dados completos (título, canal, horário, duração, views, origem),
   use `GET /api/videos`. Para forçar uma coleta antes de ler: `POST /api/refresh`.

2. **Botão "Copiar array"** no painel: copia o JSON para a área de transferência e
   mostra na tela. Respeita o filtro de texto e de origem que estiver selecionado.

3. **Botão "Exportar links (JSON)"** no painel: baixa um arquivo
   `links-eleicoes-2026-<data>.json` com o array.

## Como gerenciar os canais escaneados

Os canais ficam em `canais.json` (`handle`, `id`, `nome`, `inscritos`). Para adicionar:

```bash
node resolver-canais.js @HandleDoCanal @OutroCanal
```

O resolver converte o handle no ID do canal e imprime nome e número de inscritos.
Confira esse número: muitos handles "óbvios" de políticos e jornalistas pertencem a
homônimos ou canais de fã com poucos inscritos. Para remover um canal, apague a
entrada em `canais.json`. O servidor relê o arquivo a cada coleta; não precisa reiniciar.

## Como ajustar os critérios (`config.json`)

| Chave | Padrão | Efeito |
|---|---|---|
| `janelaMinutos` | 60 | idade máxima do vídeo desde a publicação |
| `termosBusca` | Bolsonaro, Lula, PT, PL, Flávio Bolsonaro | termos da busca na API (viram `A \| B \| "C D"`) |
| `canaisExigirTermos` | false | `true` = vídeos dos canais só entram se o título tiver um termo |
| `buscaSomenteNoticias` | true | busca só na categoria Notícias e política |
| `intervaloCanaisMinutos` | 5 | frequência da leitura dos canais |
| `intervaloBuscaMinutos` | 15 | frequência da busca (100 unidades de cota por rodada) |
| `duracaoMinSegundos` / `duracaoMaxSegundos` | 60 / 0 | filtro de duração (0 = sem limite) |

## O que não fazer

Não use este array para postar comentários automaticamente. A automação de
comentários viola a política de spam do YouTube e as regras do TSE para propaganda
eleitoral na internet. O monitor existe para a pessoa assistir e se inteirar.
