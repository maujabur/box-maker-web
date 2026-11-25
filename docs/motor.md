# Motor do plano de corte

Distribui as peças nas chapas. O objetivo, em ordem: usar menos chapas e deixar sobras úteis (um retângulo
livre grande, poucos pedaços, sem vãos presos entre peças). Não trata trajetória do laser, sequência de corte
nem fusão de linhas coincidentes: isso fica com o software da cortadora.

Números de desempenho e qualidade: [benchmarks.md](benchmarks.md).

## Geometria que entra no motor

`build()` (geometry.js) gera o contorno final de cada peça: dentes com interferência (press fit) e, com
"Compensar kerf", contorno crescido kerf/2 e furos diminuídos kerf/2. O motor usa o **retângulo envolvente
desse contorno final** (por exemplo, 500,1 × 200,1 mm para uma parede nominal de 500 × 200 com kerf 0,1).
Ele só posiciona e gira 90°: nunca altera tamanho, contorno ou compensações. A tela mostra o tamanho nominal.

- **Espaço entre peças** (`gap`, padrão 0): distância mínima entre retângulos envolventes. Com 0 as peças
  podem encostar, nunca se sobrepor (tolerância de 1e-6 mm).
- **Margem**: faixa de descarte na borda da chapa. Não conta como sobra.
- **Veio**: peça com veio marcado numa chapa com veio tem a orientação fixada (`fixed` 0 ou 1).

## Arquivos

Todos em `packing/`, sem dependências e sem DOM. Cada um funciona como `<script>` (expõe `window.BoxPack.*`),
como módulo Node (`require`) e dentro do Web Worker.

| Arquivo | Papel |
|---|---|
| `rects.js` | Maior retângulo livre (exato), retângulos livres maximais, sobras úteis sem sobreposição, união de áreas, alcance, validação de chapa. |
| `ranking.js` | Métricas e classificação das soluções. Não sabe nada dos algoritmos. |
| `engine.js` | Roda as estratégias, valida cada solução, classifica e guarda a melhor. Refinamento das melhores. Interrupção. |
| `strategies.js` | MaxRects, Guillotine, Shelf, blocos de peças iguais, ordenações. |
| `legacy.js` | Algoritmo original do Box Maker, sem mudança de lógica. Candidato em todos os modos. |
| `refine.js` | Compactação nos cantos, reposicionamento de uma chapa, passagem de peças para vãos de outras chapas, reempacotamento das chapas mais vazias. |
| `exact.js` | Busca em profundidade por menos chapas (com prova de impossibilidade). |
| `search.js` | Busca iterativa (Late Acceptance Hill Climbing) com semente. |
| `plan.js` | Modos de otimização, Web Worker, conversão de soluções para mensagens. |

`geometry.js` só prepara o problema e monta o plano final (`planSetup`, `layoutSteps`, `layout`).

## Formatos

```
Item      { id, w, h, fixed, shape }    fixed: -1 livre (0° ou 90°), 0 não gira, 1 gira 90°
                                        shape: assinatura do contorno e dos furos + veio
Problema  { items, width, height, gap, minUseful }    width/height = área útil (sem a margem)
Solução   { name, sheets: [ { rects: [ { item, x, y, w, h, rot } ] } ] }
          x, y: canto inferior esquerdo na área útil; w, h: tamanho real da peça na orientação rot
```

Peças iguais (mesma `shape`) são intercambiáveis: o agrupamento em blocos e a busca exata usam isso.
A assinatura considera contorno e furos, não só as dimensões externas.

## Validação

`engine.validate` confere toda solução candidata antes de classificá-la: cada peça uma única vez, orientação
permitida pelo veio, tamanho igual ao do item, dentro da área útil, sem sobreposição e respeitando o gap.
Solução inválida é descartada e registrada (`rejected`). `planSetup().materialize` valida de novo o que vem
do Worker. Os testes medem o plano final de forma independente (`tests/lib/harness.js`): dimensões e área
dos contornos preservadas, sem sobreposição, dentro da chapa.

## Classificação

Hierárquica: um critério só é olhado se os anteriores empatam (diferença dentro da tolerância).

| # | Critério | Melhor | Tolerância |
|---|---|---|---|
| 0 | Validade | obrigatória | — |
| 1 | Número de chapas | menor | 0 |
| 2 | Maior sobra retangular do trabalho (área) | maior | 0,25% da chapa |
| 3 | Área das sobras úteis, sem sobreposição | maior | 1% da chapa |
| 4 | Número de sobras úteis | menor | 0 |
| 5 | Alcance das sobras (bolsões) | maior | 0,5% da chapa |
| 6 | Fronteira entre peças e sobra | menor | 0,5% do perímetro |

Definições (todas calculadas na geometria, chapa a chapa, e somadas no trabalho):

- **Maior sobra**: maior retângulo livre, calculado de forma exata (varredura sobre as bordas das peças), não
  estimado pelas subdivisões do algoritmo de empacotamento. É o máximo entre as chapas: concentrar a sobra
  numa chapa só é favorecido naturalmente.
- **Sobras úteis**: tira o maior retângulo livre, marca como ocupado e repete (até 8). Só contam retângulos
  com os dois lados ≥ "menor lado de sobra aproveitável" (padrão 50 mm, configurável). Nenhuma área conta
  duas vezes; faixas estreitas não contam.
- **Alcance**: para L = 2 e 3 vezes o menor lado aproveitável, área livre onde cabe um quadrado L × L (união
  dos retângulos livres maximais com os dois lados ≥ L). Um vão preso entre peças conta pouco; o mesmo vão
  junto de uma faixa livre conta com a largura somada.
- **Fronteira**: comprimento da borda das peças voltada para a sobra (sem as bordas da chapa). Peças juntas e
  nos cantos têm fronteira curta.

O percentual de aproveitamento não é critério: com as mesmas peças e o mesmo número de chapas, a área
ocupada é constante; o que muda é a distribuição das sobras.

Para mudar a classificação, edite `CRITERIA` em `ranking.js` (os algoritmos não dependem dela).

## Estratégias

Cada estratégia recebe o problema e devolve uma ou mais soluções (ou um gerador, para mostrar andamento).

- **Original** (`legacy-*`): as quatro variantes do algoritmo anterior. Vão primeiro: em empate total vence a
  primeira, então o motor nunca devolve pior que o original.
- **MaxRects**: heurísticas BSSF, BLSF, BAF, Bottom-Left e Contact Point.
- **Guillotine**: escolha por BAF, BSSF ou BLSF; divisão horizontal, vertical, pelo eixo curto ou longo da
  sobra, por área mínima ou máxima; junta retângulos livres vizinhos.
- **Shelf**: prateleiras horizontais ou verticais, com preferência de orientação.
- **Ordenações**: área, perímetro, maior lado, largura, altura, proporção.
- **Blocos de peças iguais** (híbrido): grupos de mesma `shape` viram grades (fileiras de largura total,
  colunas de altura total ou quase quadradas), na orientação original, na que cabe mais por chapa ou metade em
  cada; os blocos e as peças soltas são posicionados por MaxRects ou Guillotine, que preenchem o resto.
- **Busca exata** (`exact.js`): as peças cabem em T chapas? Preenche sempre o ponto livre mais baixo e mais à
  esquerda, com uma peça ou declarando sobra, dentro da folga `T × chapa − área das peças`. Poda pela largura
  que nenhuma combinação de peças cobre. Tenta T = melhor até ali − 1, descendo. Se esgota sem achar, provou
  que não dá: a melhor solução é ótima em número de chapas, e a busca iterativa usa isso para parar cedo.
- **Busca iterativa** (`search.js`): solução codificada como ordem + orientação de cada peça + algoritmo
  decodificador. Movimentos: passar uma peça da chapa mais vazia para antes, trocar, mover, inverter trecho,
  mudar orientação, mudar decodificador. Aceitação LAHC (não pior que a de 40 passos atrás). Custo:
  `chapas + ocupação da chapa mais vazia − 0,1 × maior sobra dela`. Reinicia de outra semente sem melhora.
- **Refinamento** (`refine.js`), aplicado às 3 melhores soluções distintas: esvaziar uma das chapas mais vazias
  nos vãos das outras; reempacotar as 2 a 4 chapas mais vazias em menos; reposicionar as peças de cada chapa
  com todos os algoritmos; deslizar as peças para cada um dos 4 cantos.

## Modos

| Modo | Estratégias | Uso |
|---|---|---|
| Rápida | original (completo até 120 peças), MaxRects BSSF/BAF/CP, Guillotine, Shelf, blocos, busca exata de 20 000 nós, compactação | recalcula sozinho durante a edição (aba aberta, até 200 peças) |
| Equilibrada | todas as estratégias e ordenações, busca exata de 150 000 nós, busca iterativa com avaliações fixas, refinamento completo | padrão; ao abrir a aba e ao baixar |
| Intensiva | Equilibrada + busca exata por 40% do tempo + busca iterativa até o limite | botão "Busca intensiva"; mostra a melhor parcial; "Parar" fica com a melhor |

Reprodutibilidade: Rápida e Equilibrada dão sempre o mesmo plano para o mesmo projeto. A busca iterativa
usa semente derivada do problema (ou `cfg.optSeed`); com o mesmo número de avaliações (`cfg.optEvals`) o
resultado é idêntico. Com limite de tempo, o número de avaliações depende da máquina.

## Web Worker e file://

`new Worker('arquivo.js')` é bloqueado quando a página é aberta por `file://`. O Worker é montado num Blob a
partir das próprias funções dos módulos (`root.__BoxPackMods`, ver `plan.workerSource`). Funciona offline e
por `file://` (testado no Chromium). Sem Worker (navegador antigo ou política de segurança), a página roda o
mesmo código em fatias de 40 ms. Interromper = encerrar o Worker; a página fica com a última melhor solução
recebida (validada de novo).

## Como estender

- **Nova estratégia**: uma função `run(problem, opts, state)` que devolve soluções no formato acima; inclua em
  `strategiesFor` (`plan.js`). O motor valida e classifica; `state.top(k)` dá as melhores até ali,
  `state.notes` passa informações para as estratégias seguintes.
- **Novo critério**: entrada em `CRITERIA` (`ranking.js`) com `value`, `dir` e `tol`; métricas por chapa em
  `evaluate`.
- **Nesting poligonal (NFP), no futuro**: entraria como mais uma estratégia que usa o contorno real
  (`item` pode carregar o polígono) e devolve posições com rotação. Seria preciso: (1) a solução aceitar
  ângulos além de 0°/90° e posições não retangulares; (2) a validação passar a usar os contornos (hoje usa os
  retângulos envolventes, o que é conservador e suficiente para as estratégias atuais); (3) as métricas de
  sobra usarem a área livre real. Ranking, modos, Worker e interface não mudam.

## Testes

```
node --test tests/        # validade, ótimos conhecidos, comparação com o original, modos, Worker, interrupção
node tests/bench.js       # ver benchmarks.md
node tests/show.js 2 5 5  # desenha em texto o plano de 2 caixas, gap 5, margem 5
node tests/families.js    # qual estratégia vence em cada cenário
```

Cenários em `tests/lib/scenarios.js`: caixas reais de vários tamanhos, várias caixas iguais, vários modelos no
mesmo plano, chapas de tamanhos diferentes, veio, kerf e interferência diferentes, gap zero e positivo,
margens, faixas, orientação mista, sobras fragmentadas, chapa eliminável, peça maior que a chapa e encaixes
perfeitos com ótimo conhecido (gerados por cortes guilhotinados). `tests/baseline.json` guarda o resultado do
algoritmo original antes do novo motor.

## Referências

- J. Jylänki, *A Thousand Ways to Pack the Bin – A Practical Approach to Two-Dimensional Rectangle Bin
  Packing* (2010), e [RectangleBinPack](https://github.com/juj/RectangleBinPack): MaxRects, Guillotine, Shelf
  e heurísticas de escolha.
- E. K. Burke, Y. Bykov, *The Late Acceptance Hill-Climbing Heuristic* (2017).
- Largest Empty Rectangle: varredura sobre as bordas dos obstáculos (o número de peças por chapa é pequeno).
