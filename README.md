# Box Maker

Gerador de caixas com encaixe de dentes (finger joints) para corte a laser.
Roda inteiramente no navegador: configure a caixa, veja a montagem em 3D e exporte SVG, DXF ou CSV.

Por Mauricio Jabur – MauMaker. Built with Kiro.

## Uso
- **Local:** abra `index.html` com duplo clique no navegador. Não precisa de servidor, build ou internet.
- **GitHub Pages:** publique estes arquivos na raiz da branch (Settings → Pages → Deploy from a branch).

## O que dá para configurar
1. **Dimensões e material** — comprimento, largura, altura (externas ou internas), espessura, kerf e interferência geral.
2. **Dentes de encaixe** — largura (ou número de divisões) por eixo, independente para arestas verticais, fundo (X/Y) e tampa (X/Y); chanfro nos dois lados do encaixe.
3. **Fundo e tampa** — por fora (cobre as paredes) ou por dentro (entre as paredes), com ou sem dentes; recuo e folga específicos da tampa.
4. **Furos oblongos** — por parede, e por lado (frente/trás/esquerda/direita) na tampa e no fundo; espelhamento e centralização automática.
5. **Chapa e organização** — tamanho da chapa, espaço entre peças, margem e veio da madeira (da chapa e de cada peça).

## Exportação
- **SVG / DXF** (botões do topo): um arquivo com todas as chapas organizadas automaticamente, empilhadas, cada uma com um contorno de referência em azul (camada `CHAPA` no DXF). As peças individuais de cada chapa também podem ser baixadas separadamente, na aba "Peças para corte".
- **CSV**: lista de peças (sem furos/dentes) no formato de importação do [Cutlist Optimizer](https://www.opticutter.com/cut-list-optimizer/import/csv) (opticutter.com), para organizar o corte de várias caixas de uma vez.
- **JSON**: salva/abre a configuração completa do projeto.

## Notas técnicas
- **Kerf**: com "Compensar kerf" ligado, contornos externos crescem kerf/2 e furos diminuem kerf/2, para a peça saír na medida nominal depois do corte.
- **Interferência** (seção 1): estreita os rasgos em geral, para um press-fit mais justo.
- **Folga da tampa** (seção 3): o oposto, só nos rasgos que recebem os dentes da tampa — alarga para um encaixe mais solto ali.
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
- `geometry.js` — toda a geometria (dentes, furos, organização em chapas) e exportação SVG/DXF/CSV. Sem dependências.
- `view3d.js` — visualização 3D (usa `vendor/three.min.js`).
- `vendor/` — three.js (MIT), embutido para funcionar offline/GitHub Pages.
