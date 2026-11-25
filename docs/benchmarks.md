# Benchmarks do plano de corte

Medidos em 25/11/2026, Node 20.19, Intel Core i3-1315U (8 threads), um núcleo por cálculo. No navegador o
tempo é parecido (o cálculo roda num Web Worker). Os números de tempo variam com a máquina; os de chapas
e sobras, não (exceto na intensiva, que depende de quantos arranjos cabem no tempo).

Para reproduzir:

```
node tests/bench.js --mode legacy      # algoritmo original (referência)
node tests/bench.js --mode fast
node tests/bench.js --mode balanced
node tests/bench.js --mode intensive --time 15
node tests/bench.js --compare tests/baseline.json   # compara com o original gravado antes do novo motor
node tests/stress.js 10 30 100                      # tempo com muitas caixas
```

Os resultados desta tabela estão em `tests/results/*.json`.

## Cenários

Cada célula: **chapas · maior sobra retangular (mm) · tempo**. "Ótimo": número de chapas ótimo conhecido;
com `*`, é só o limite inferior por área (pode não ser alcançável: por exemplo, com kerf 0,1 mm duas peças
de 500 mm medem 1000,2 mm e não cabem lado a lado numa chapa de 1000 mm).

| Cenário | Ótimo | Original | Rápida | Equilibrada | Intensiva (15 s) |
|---|---|---|---|---|---|
| caixa única 500x300x200, gap 0 | 1* | 2 · 800×800 · 224 ms | 2 · 800×800 · 263 ms | 2 · 800×800 · 310 ms | 2 · 800×800 · 320 ms |
| caixa única, gap 5 margem 5 | 1* | 2 · 790×790 · 102 ms | 2 · 790×790 · 109 ms | 2 · 790×790 · 145 ms | 2 · 790×790 · 174 ms |
| 2 caixas 500x300x200, gap 5 margem 5 (sobra contínua) | 2* | 2 · 990×85 · 166 ms | 2 · 990×85 · 187 ms | 2 · 990×85 · 224 ms | 2 · 990×85 · 259 ms |
| 10 caixas 500x300x200, gap 5 margem 5 | 8* | 10 · 990×85 · 615 ms | 10 · 990×85 · 646 ms | 10 · 990×85 · 939 ms | 10 · 990×85 · 15.2 s |
| 4 caixas iguais 500x300x200 | 4* | 4 · 1000×100 · 139 ms | 4 · 1000×100 · 148 ms | 4 · 1000×100 · 225 ms | 4 · 1000×100 · 260 ms |
| 10 caixas pequenas 100x80x60, chapa 600x400 | 2* | 2 · 179×400 · 385 ms | 2 · 179×400 · 375 ms | 2 · 600×120 · 539 ms | 2 · 600×120 · 915 ms |
| caixa grande em chapa pequena 1200x600 | 2* | 2 · 400×200 · 178 ms | 2 · 400×200 · 173 ms | 2 · 400×200 · 208 ms | 2 · 400×200 · 194 ms |
| kerf 0,3 e fit 0,2, gap 2 | 3* | 3 · 994×91 · 174 ms | 3 · 994×91 · 178 ms | 3 · 994×91 · 231 ms | 3 · 994×91 · 226 ms |
| sem compensação de kerf | 3* | 3 · 1000×500 · 54 ms | 3 · 1000×500 · 54 ms | 3 · 1000×500 · 109 ms | 3 · 1000×500 · 113 ms |
| veio horizontal na chapa, peças com veio | 3* | 4 · 1000×600 · 100 ms | 4 · 1000×600 · 107 ms | 4 · 1000×600 · 319 ms | 4 · 1000×600 · 815 ms |
| modelos: 1× 200x300x500 + 2× 100x150x300 | 2* | 2 · 600×800 · 114 ms | 2 · 600×800 · 100 ms | 2 · 600×800 · 141 ms | 2 · 600×800 · 163 ms |
| modelos: 3 tamanhos, chapa 800x600, margem 10 | 2* | 2 · 234×379 · 420 ms | 2 · 234×379 · 445 ms | 2 · 234×379 · 612 ms | 2 · 206×460 · 1.1 s |
| ótimo: 4 peças 500x400 em 1000x800 | 1 | 1 · 0×0 · 1 ms | 1 · 0×0 · 2 ms | 1 · 0×0 · 7 ms | 1 · 0×0 · 9 ms |
| ótimo: 12 peças 300x100 (faixas) em 900x400 | 1 | 1 · 0×0 · 36 ms | 1 · 0×0 · 42 ms | 1 · 0×0 · 48 ms | 1 · 0×0 · 63 ms |
| ótimo: 2 chapas de peças 100x200 (12 por chapa 600x400) | 2 | 2 · 0×0 · 72 ms | 2 · 0×0 · 79 ms | 2 · 0×0 · 110 ms | 2 · 0×0 · 105 ms |
| ótimo: faixas verticais 100x700 + horizontais 900x100 | 1 | 1 · 800×100 · 33 ms | 1 · 100×800 · 34 ms | 1 · 100×800 · 59 ms | 1 · 100×800 · 48 ms |
| ótimo: orientação mista (peças 300x100 e 100x300) | 1 | 1 · 0×0 · 36 ms | 1 · 0×0 · 38 ms | 1 · 0×0 · 50 ms | 1 · 0×0 · 52 ms |
| ótimo: tiling guilhotinado 12 peças (sem veio) | 1 | 2 · 830×800 · 81 ms | 1 · 0×0 · 110 ms | 1 · 0×0 · 118 ms | 1 · 0×0 · 117 ms |
| ótimo: tiling guilhotinado 24 peças (sem veio) | 1 | 2 · 840×800 · 220 ms | 2 · 860×800 · 295 ms | 2 · 870×800 · 660 ms | 2 · 910×800 · 15.0 s |
| ótimo: 2 tilings de 14 peças | 2 | 3 · 870×800 · 186 ms | 3 · 870×800 · 255 ms | 3 · 870×800 · 702 ms | 2 · 0×0 · 4.5 s |
| ótimo: tiling 20 peças, chapa 900x500 | 1 | 2 · 820×500 · 129 ms | 2 · 820×500 · 173 ms | 2 · 820×500 · 481 ms | 2 · 820×500 · 15.0 s |
| veio vertical força orientação (peças 300x100 com veio v) | 1* | 1 · 0×0 · 20 ms | 1 · 0×0 · 25 ms | 1 · 0×0 · 35 ms | 1 · 0×0 · 33 ms |
| sobras fragmentadas: muitas pequenas e poucas grandes | 2* | 2 · 740×800 · 178 ms | 2 · 740×800 · 196 ms | 2 · 760×800 · 334 ms | 2 · 760×800 · 969 ms |
| eliminar uma chapa por reorganização | 3* | 3 · 800×800 · 51 ms | 3 · 800×800 · 55 ms | 3 · 800×800 · 84 ms | 3 · 800×800 · 85 ms |
| muitas peças pequenas iguais (100x50 ×150) | 1* | 1 · 200×200 · 46 ms | 1 · 200×250 · 74 ms | 1 · 200×250 · 384 ms | 1 · 200×250 · 4.8 s |
| mistura aleatória de 60 peças | 2* | 2 · 550×800 · 570 ms | 2 · 550×800 · 589 ms | 2 · 550×800 · 864 ms | 2 · 550×800 · 1.9 s |
| gap positivo: 12 peças 300x100 com gap 5 em 900x400 | 1* | 1 · 900×100 · 23 ms | 1 · 900×100 · 28 ms | 1 · 900×100 · 42 ms | 1 · 900×100 · 41 ms |
| peça maior que a chapa | 1* | 2 · 1000×600 · 0 ms | 2 · 1000×600 · 1 ms | 2 · 1000×600 · 6 ms | 2 · 1000×600 · 8 ms |

## Resumo

Comparação com o algoritmo original, cenário a cenário, pela classificação hierárquica (chapas; maior
sobra; sobras úteis; alcance das sobras), com as mesmas tolerâncias do motor:

| Modo | Cenários com menos chapas | Melhores | Piores | Tempo total (28 cenários) | Pior caso |
|---|---|---|---|---|---|
| Rápida | 1 | 5 | 0 | 4,8 s | 0,6 s |
| Equilibrada | 1 | 7 | 0 | 8,0 s | 0,9 s |
| Intensiva (15 s) | 2 | 9 | 0 | 62,5 s | 15,2 s (limite) |

Original: 65 chapas no total; Rápida e Equilibrada: 64; Intensiva: 63.

A Intensiva termina antes do limite quando já está no ótimo provado (a busca exata prova que não cabe em
menos chapas) ou no limite inferior sem melhora; só os casos difíceis usam o tempo todo.

## Muitas caixas (500 × 300 × 200, chapa 1000 × 800, gap 0, margem 0)

```
qty 10 (60 peças) legacy: 11 chapas (limite por área 8), 764 ms, erros 0, estratégia legacy-simple
qty 10 (60 peças) fast: 11 chapas (limite por área 8), 522 ms, erros 0, estratégia legacy-simple
qty 10 (60 peças) balanced: 11 chapas (limite por área 8), 967 ms, erros 0, estratégia legacy-simple
qty 30 (180 peças) legacy: 31 chapas (limite por área 24), 1032 ms, erros 0, estratégia legacy-simple
qty 30 (180 peças) fast: 31 chapas (limite por área 24), 687 ms, erros 0, estratégia legacy-simple
qty 30 (180 peças) balanced: 31 chapas (limite por área 24), 1385 ms, erros 0, estratégia refine
qty 100 (600 peças) legacy: 101 chapas (limite por área 78), 1863 ms, erros 0, estratégia legacy-free
qty 100 (600 peças) fast: 102 chapas (limite por área 78), 703 ms, erros 0, estratégia refine
qty 100 (600 peças) balanced: 101 chapas (limite por área 78), 2620 ms, erros 0, estratégia legacy-free
```

Até 120 peças o modo Rápido roda o algoritmo original completo e nunca usa mais chapas que ele (teste em
`tests/layout.test.js`). Acima disso usa só as variantes baratas do original, e pode usar uma chapa a mais
(102 contra 101 com 100 caixas); a edição não recalcula sozinha acima de 200 peças.

## Limites de tempo

- **Rápida**: sem limite de tempo; abaixo de 0,7 s em todos os casos medidos (até 600 peças).
- **Equilibrada**: busca exata limitada a 150 000 nós e busca iterativa com número fixo de avaliações
  (1500 até 40 peças, 600 até 120, 150 até 300, nenhuma acima). Abaixo de 1 s até 60 peças; 2,6 s com 600.
- **Intensiva**: padrão 15 s (configurável de 2 a 300 s). 40% para a busca exata, o resto para a busca
  iterativa. "2 tilings de 14 peças" só é resolvido com 11 s ou mais (a busca exata precisa de ~4 s).

## Casos ainda não resolvidos

- Tilings perfeitos de 20 e 24 peças (ótimo 1 chapa): nenhum modo encontra; ficam em 2.
- 10 caixas 500 × 300 × 200 com gap 0 e margem 0: original, Rápida e Equilibrada dão 11 chapas; a
  Intensiva chega a 10.
