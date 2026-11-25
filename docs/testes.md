# Testes

## Como rodar

```
node --test tests/        # toda a suíte (Node 18+, sem dependências)
node --test tests/cutlist.test.js
```

## Onde fica cada coisa

| Camada | Arquivos | O que testa |
|---|---|---|
| Geometria | `geometry.js`, `tests/layout.test.js`, `tests/list.test.js` | Peças, dentes, plano de corte, SVG/DXF/CSV |
| Motor do plano | `packing/`, `tests/engine.test.js`, `search`, `refine`, `rects`, `strategies` | Validade, ótimos conhecidos, modos |
| **Regras da lista de corte** | `cutlist.js`, `tests/cutlist.test.js` | Normalização, exclusões, o que entra no plano, chave de recálculo |
| Interface | `app.js`, `index.html`, `style.css` | Ainda sem testes automáticos (ver abaixo) |

`cutlist.js` segue o padrão de `geometry.js` e de `packing/`: sem DOM e sem dependências, funciona como `<script>`
(`window.BoxCut`) e como módulo Node (`require`). **Regra do projeto:** lógica que não precisa da página fica num módulo
assim, e `app.js` só liga a lógica aos controles. É isso que permite testar a lógica sem navegador.

O teste `chaves de peça` em `cutlist.test.js` também lê `app.js` e confere que `PIECES` tem as mesmas peças de
`G.build`, para a interface e a lógica não se separarem sem aviso.

## Regras para manter

1. Toda fase nova (ver [evolucao-materiais.md](evolucao-materiais.md)) traz seus testes junto, no mesmo commit.
2. Antes de commitar: `node --test tests/` inteiro, sem falhas.
3. Comportamento novo do plano ou do CSV ganha teste em `tests/list.test.js` (pelo `G.layout` e `G.toCSV`). Regra
   nova da lista ou do projeto salvo ganha teste em `tests/cutlist.test.js`.
4. Mudança no formato do projeto salvo (JSON e localStorage) precisa de teste de **projeto antigo**: o formato anterior
   continua abrindo, e salvar e abrir de novo não muda nada (idempotência).
5. Com um só material e uma só chapa, o plano e os arquivos exportados devem continuar **idênticos** aos de antes
   (compatibilidade prevista nas Fases B e C).

## Planejado: testes de navegador (opção B)

Ainda **não implementado**. Cobriria o que os testes em Node não alcançam: clicar, digitar, ver o resultado na tela e
comparar capturas de imagem (por exemplo, o peso visual de um bloco novo na gaveta da lista de corte).

Proposta:

- Ferramenta: [Playwright](https://playwright.dev/).
- Pasta `tests/e2e/` com `package.json` **próprio**, para o projeto principal continuar sem dependências e sem build.
- A página abre por `file://`, como o usuário final usa, sem servidor.
- Primeiros testes sugeridos, quando a interface crescer (Fases B e C, com cadastro de materiais e chapas):
  1. Abrir a página, adicionar uma caixa à lista, excluir uma peça e conferir a contagem "a cortar" e o plano.
  2. Recarregar a página e conferir que a lista e as exclusões foram mantidas (localStorage).
  3. Baixar o CSV e conferir as quantidades.
  4. Capturas da gaveta da lista de corte, para detectar regressão visual.
- **Quando fazer:** antes da Fase B terminar, porque ela cria telas novas (material, textura e espessura por face).
  Até lá, a interface da Fase A é conferida à mão.
- Pré-requisitos a combinar na hora: Node 18+ e o download do navegador do Playwright (`npx playwright install chromium`).
- Fora do escopo: rodar em CI. Pode vir depois, se o repositório passar a usar GitHub Actions.
