# Box Maker

Gerador de caixas com encaixe de dentes (finger joints) para corte a laser.
Roda inteiramente no navegador: configure a caixa, veja a montagem em 3D e exporte SVG, DXF ou CSV.

Por Mauricio Jabur – MauMaker. Built with Kiro.

## Uso
- **Local:** abra `index.html` com duplo clique no navegador. Não precisa de servidor, build ou internet.
- **GitHub Pages:** publique estes arquivos na raiz da branch (Settings → Pages → Deploy from a branch).

## O que dá para configurar
1. **Dimensões e material** — comprimento, largura, altura (externas ou internas), espessura, kerf e interferência geral.
2. **Fundo e tampa** — por fora (cobre as paredes) ou por dentro (entre as paredes), com ou sem dentes; recuo e ajuste (aperto ou folga) específicos da tampa.
3. **Dentes de encaixe** — largura (ou número de divisões) por eixo, independente para arestas verticais, fundo (X/Y) e tampa (X/Y); chanfro nos dois lados do encaixe.
4. **Furos oblongos** — por parede, e por lado (frente/trás/esquerda/direita) na tampa e no fundo; espelhamento e centralização automática.
5. **Veio das peças** — direção do veio de cada peça (é da caixa: vai junto para a lista de corte).
6. **Chapa e organização** — tamanho da chapa, espaço mínimo entre peças (padrão 0), margem e veio da chapa.

Na aba "Peças para corte", o botão **Otimização** (acima das chapas) tem o modo de otimização do plano, o tempo máximo da busca intensiva, o menor lado de sobra aproveitável e o destaque das sobras na tela.

## Exportação
- **SVG / DXF** (botões do topo): um arquivo com todas as chapas do plano de corte, empilhadas, cada uma com um contorno de referência em azul (camada `CHAPA` no DXF). As peças individuais de cada chapa também podem ser baixadas separadamente, na aba "Peças para corte".
- **Plano de corte**: calculado ao abrir a aba "Peças para corte", pelo botão ou ao baixar; com a aba aberta, atualiza sozinho (modo rápido) enquanto você edita. Critério: menos chapas; depois a maior sobra retangular; depois mais área em sobras aproveitáveis, em menos pedaços e sem vãos presos entre peças. "Adicionar ao corte" (no topo) guarda a caixa do painel numa lista de corte; na aba "Peças para corte", o botão "Lista de corte" abre a lista, com nome e quantidade de cada caixa (0 = guardada, fora do plano) e as ações editar, atualizar, duplicar e remover. Em cada linha, "Excluir peças do plano" tira unidades de uma peça específica (já produzidas ou adiadas): com 3 caixas e uma lateral esquerda já pronta, exclua 1 da Esquerda e o plano e o CSV passam a ter 2 laterais esquerdas e 3 de cada outra peça. Com a lista vazia, o plano usa a caixa do painel. Espessuras diferentes vão para chapas separadas (um arquivo por espessura). O zoom das chapas fica acima delas (inteira, largura ou %).
  - Modos: **Rápida**, **Equilibrada** (padrão, sempre o mesmo resultado para o mesmo projeto) e **Intensiva** (busca até o tempo máximo, mostra a melhor solução encontrada e pode ser interrompida).
  - Indicadores: chapas, aproveitamento de cada chapa e do trabalho, material restante, maior sobra de cada chapa e do trabalho. Na tela, as sobras aproveitáveis aparecem destacadas com as dimensões (nunca nos arquivos de corte).
  - Detalhes do motor em [docs/motor.md](docs/motor.md); números em [docs/benchmarks.md](docs/benchmarks.md).
- **CSV**: lista de peças (sem furos/dentes) da caixa do painel ou de todas as caixas da lista de corte, com as quantidades, no formato de importação do [Cutlist Optimizer](https://www.opticutter.com/cut-list-optimizer/import/csv) (opticutter.com), para organizar o corte de várias caixas de uma vez.
- **JSON**: salva/abre a configuração completa do projeto.

## Notas técnicas
- **Kerf**: com "Compensar kerf" ligado, contornos externos crescem kerf/2 e furos diminuem kerf/2, para a peça saír na medida nominal depois do corte.
- **Interferência** (seção 1): diferença total de largura entre dente e rasgo em todas as junções (exceto a tampa, se ela tiver ajuste próprio), para um press-fit mais justo. Dividida meio a meio: o dente cresce metade e o rasgo encolhe metade (como o kerf, nas duas peças).
- **Ajuste da tampa** (seção 2): valor próprio da junção da tampa, independente da interferência geral e também dividido entre dente e rasgo. Positivo = aperto, zero = nominal, negativo = folga (padrão −0,1 mm). Com "Ajuste da tampa igual à interferência geral" marcado, a tampa segue o valor da seção 1.
- **Espaço entre peças**: distância mínima entre os contornos já compensados (kerf e interferência). Com 0 (padrão), as peças podem encostar, mas nunca se sobrepõem; as linhas coincidentes continuam no arquivo (a fusão de linhas fica com o software da cortadora). A margem da chapa é descarte e não conta como sobra.
- **Cantos**: o número de divisões por aresta é sempre ímpar; as duas pontas são cantos lisos, dimensionados para nunca ficarem menores que duas espessuras de material (evita geometria frágil ou impossível no canto).
- O projeto fica salvo automaticamente no navegador (localStorage). Use "Salvar projeto" / "Abrir projeto" para guardar em arquivo.

## Visualização 3D
A aba "Montagem 3D" mostra a caixa montada (arraste para girar, Shift ou botão direito para mover, roda para zoom).
Cada peça pode ser sólida ou transparente (só as arestas), ter cor própria, e ser "explodida" individualmente com um
afastamento comum controlado por um slider.
A biblioteca three.js está em `vendor/` (licença MIT), embutida localmente — tudo funciona sem internet.

## Estrutura do projeto
- `index.html`, `style.css` — interface.
- `app.js` — estado da configuração, ligação dos controles, exportação de arquivos.
- `geometry.js` — toda a geometria (dentes, furos), preparação do plano de corte e exportação SVG/DXF/CSV. Sem dependências.
- `packing/` — motor do plano de corte (estratégias, classificação, busca, Web Worker). Sem dependências; ver [docs/motor.md](docs/motor.md).
- `tests/` — testes e benchmarks (Node 18+, sem dependências): `node --test tests/` e `node tests/bench.js`.
- `docs/` — documentação técnica do motor e benchmarks.
- `view3d.js` — visualização 3D (usa `vendor/three.min.js`).
- `vendor/` — three.js (MIT), embutido para funcionar offline/GitHub Pages.
