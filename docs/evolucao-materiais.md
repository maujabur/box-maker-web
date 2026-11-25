# Evolução: materiais, chapas e controle de produção

Documento de planejamento. **Nenhum código foi alterado.** Registra os desejos, o que o sistema faz hoje,
as decisões já tomadas, o modelo proposto e as perguntas que restam. Status: rascunho, 4ª revisão. Sem perguntas bloqueantes para a Fase A.

## 1. Desejos originais

1. Definir vários tipos de chapa (dimensões diferentes, aproveitamento de retalhos, projetos com várias espessuras).
2. Definir um tipo de chapa para cada face, inclusive com espessura diferente.
3. Ter uma dimensão de cor, textura ou tipo de material, para cruzar com os tipos de chapa. Exemplos: tampa branca e
   corpo de outra textura; uma cor por face; base de outro material. Em algumas faces a espessura importa mas a
   cor/textura não (caso de retalhos).
4. Na lista de corte, descontar faces já produzidas de cada linha (exemplo: fazer um tampo a menos nesta leva).

O modelo final não precisa seguir esta lista. O que importa é resolver os conceitos.

## 2. Decisões tomadas

| # | Decisão |
|---|---|
| D1 | Uma face pode ser de outro material (acrílico, tela, fundo ou tampo diferente), com espessura própria. **Não** se define tipo de dente por aresta: a geometria do encaixe é derivada. |
| D2 | Três campos, em vez de um só: **material** (MDF, acrílico), **textura** (superfície: "branco", "carvalho") e **espessura**. A textura substitui o conceito de "cor". |
| D3 | A **cor exibida no 3D é independente** de material e textura e continua como hoje (cor por peça). |
| D4 | Retalhos e chapas inteiras são o mesmo objeto: **chapa**, cadastrada à mão. |
| D5 | Cada chapa tem **estoque ilimitado** (como commodity) ou **quantidade limitada** (o que existe à mão). |
| D6 | Se não houver chapa suficiente, o sistema informa **quanto falta (m²)**, em vez de falhar em silêncio. |
| D7 | **Facilidade de uso básico primeiro.** Quem quer só uma caixa de 6 mm com a chapa que tem **não configura nada além do que faz hoje**: o sistema cria sozinho um material, uma textura "qualquer" e uma chapa ilimitada padrão. Quem quiser avançar configura o resto. |
| D8 | **Veio é propriedade da chapa e também da peça.** |
| D9 | **Sem tolerância de espessura.** A chapa é cadastrada com a espessura que o usuário escolher (por exemplo, uma de 5,9 mm cadastrada como 6). A geometria usa esse valor nominal, e a diferença real nos dentes é aceita por quem decidiu. |
| D10 | Um **único contador** por face na lista de corte cobre "não vou produzir agora" e "já produzi antes ou de outra forma". O desconto é por face individual de cada linha (3.5). Nome na interface: **"Excluir"** (quantas unidades da face saem do plano), com o restante em **"A cortar"**. O nome é só texto da interface e pode ser trocado sem afetar o modelo (alternativa citada: "Ignorar"). |
| D11 | **Dentes em duas etapas.** Primeira: todas as faces levam dentes, com tampa e fundo especiais como hoje. Segunda: escolher por face se leva dente e se ele é externo ou interno (ver 3.3). |
| D12 | **Conflitos de combinação na etapa 2 dos dentes** (quem cobre quem em cada canto) **não serão desenhados agora**. Definir uma regra por vértice complica o modelo, e a regra só será decidida quando a Fase E for implementada. |
| D13 | Material e textura são **texto livre com sugestões** dos valores já usados no projeto, sem tela de cadastro. |

## 3. Situação atual e avaliação

### 3.1 Como o sistema funciona hoje

- **Uma espessura por caixa** (`cfg.t`). Todas as peças da caixa usam a mesma, e `build()` (geometry.js) calcula dentes,
  rasgos, medidas internas e tampa a partir dela.
- **Uma chapa por trabalho**: `sheetW`, `sheetH`, `gap`, `margin`, `grain` ficam em `JOB_KEYS` (app.js) e valem para toda
  a lista de corte.
- **Lista de corte** (`cutList`): cada entrada tem `id`, `name`, `qty` (0 a 999) e a `box` completa. A quantidade é por
  caixa, não por peça.
- **Espessuras diferentes** entre caixas da lista já vão para chapas separadas (um arquivo por espessura), mas na mesma
  medida de chapa e com estoque ilimitado.
- **Cor**: existe só na visualização 3D (cor por peça). Não afeta o plano de corte.
- **Motor** (`packing/`): recebe um problema com uma única chapa (`width`, `height`) e peças que só diferem por
  tamanho, veio e `shape`. Não conhece estoque, material nem textura.

### 3.2 Material, textura e chapa (itens 1, 2 e 3)

Cada **chapa** é cadastrada com: material, textura, espessura, largura, altura, quantidade (ou ilimitada) e veio.
Cada **face** exige: material, espessura e textura (uma específica, ou **"qualquer"**).

Regra de compatibilidade:

```
chapa serve para a face  se  material igual
                          e  espessura igual
                          e  (face aceita qualquer textura  ou  textura igual)
```

Isso resolve o caso dos retalhos ("qualquer textura em MDF de 6 mm") sem listas de materiais aceitos nem grupos. A
textura "qualquer" é o padrão de uma face nova, e por isso quem não usa texturas nem vê o campo.

**Uso básico (D7).** O projeto abre com: material "MDF" (ou nome neutro), textura "qualquer", espessura igual à da caixa
e uma chapa ilimitada com o tamanho atual de `sheetW`/`sheetH`. O plano de corte funciona como hoje, sem nenhum
cadastro. O cadastro de chapas e as opções por face ficam numa área à parte, para quem precisar.

### 3.3 Espessura e dentes por face (itens 1 e 2, D1 e D11)

**Espessura por face.** Com materiais de espessuras diferentes nas faces, a regra de encaixe passa a ser derivada:

- O dente de uma peça entra no rasgo da peça vizinha. O **comprimento do dente** vem da espessura da peça que recebe, e o
  **rasgo** cortado na vizinha tem a largura da espessura da peça que entra.
- **Medidas internas** (`outerDims`, modo `inner`) somam 2×t em X e Y e t do fundo e da tampa em Z. Passam a somar a
  espessura real de cada parede, do fundo e da tampa.
- **Recuo e ajuste da tampa**, **chanfro**, **canto mínimo de duas espessuras** e **kerf** precisam definir qual
  espessura usam em cada junção. Proposta inicial: a espessura da peça cuja borda está sendo desenhada para o canto
  mínimo, e a da peça que recebe para a profundidade do dente.
- Furos e visualização 3D também usam a espessura de cada peça.

**Etapa 1 dos dentes.** Todas as faces levam dentes, como hoje. Tampa e fundo continuam com seus modos especiais
(por fora ou por dentro, com ou sem dentes).

**Etapa 2 dos dentes.** Por face: leva dente ou não, e o encaixe é externo (a face cobre as vizinhas) ou interno (fica
entre elas). Isso traz **conflitos de combinação**, por exemplo uma tampa externa e uma lateral também externa
disputando o mesmo canto. Esse desenho **fica para a implementação da Fase E** (D12). Quando chegar a hora, ela
precisará de:

- uma lista das combinações válidas por aresta (quem cobre quem, quem entra entre quem);
- uma regra de validação que avise de combinação impossível, em vez de gerar uma peça errada em silêncio;
- decisão sobre o que acontece com faces **sem dentes** e sem corte a laser (tela, vidro comprado pronto): saem do plano
  e do CSV, mas continuam no 3D e nas medidas da caixa.

Hoje tampa e fundo já resolvem uma parte disso (o `lidPos` e o `bottomMode` em app.js), e esse código é o ponto de partida.

### 3.4 Impacto no motor de corte

- Hoje o motor resolve **um problema por chapa de um só tamanho**. O caminho de menor mudança é **não alterar o motor
  no começo**: agrupar as peças por material, textura (quando específica) e espessura, e rodar o motor uma vez por
  grupo, como já se faz por espessura.
- **Várias medidas de chapa** no mesmo grupo, cada uma com estoque (D5), é um problema de *bin packing com caixas de
  tamanhos diferentes e quantidade limitada*. Exige mudar o motor (`Problema` com lista de chapas, validação,
  métricas de sobra). Heurística inicial: usar primeiro as chapas limitadas, da menor que serve para a maior; depois as
  ilimitadas.
- **Faces com textura "qualquer"** podem ir para chapas de texturas diferentes. Heurística inicial: tentar primeiro as
  chapas limitadas compatíveis, depois as ilimitadas.
- **Veio por chapa e por peça (D8).** Regra proposta, igual à de hoje, aplicada chapa a chapa: peça com veio marcado numa
  chapa com veio tem a orientação fixada; peça sem veio, ou chapa sem veio, gira livremente.
- Entra um critério novo e anterior a todos os da classificação: **todas as peças colocadas**.
- **Falta de chapa (D6).** Quando as chapas limitadas acabam e não há chapa ilimitada compatível, as peças sem lugar
  aparecem como pendentes, com a **área que falta (m²)** por material, textura e espessura. Não é erro: o plano das
  demais peças é mostrado e exportável. Uma peça maior do que qualquer chapa cadastrada do grupo aparece em separado,
  porque mais chapas do mesmo tamanho não resolvem.

### 3.5 Descontar peças produzidas (item 4, D10)

Independe dos itens 1 a 3 e entrega valor sozinho.

**Exemplo do autor.** A linha da lista é uma caixa com tiragem de 3. Já existe 1 lateral esquerda produzida. Faltam
produzir 2 laterais esquerdas, e as demais faces continuam 3.

O desconto é **por face individual da linha**, não por forma geométrica. Mesmo que a lateral esquerda e a direita tenham
o mesmo tamanho e o motor as trate como intercambiáveis ao cortar, o desconto é registrado em "lateral esquerda",
porque é isso que o usuário sabe que já tem.

Proposta:

- Cada linha da lista guarda, por face, o contador "Excluir": quantas unidades já existem ou não serão produzidas agora.
- Quantidade a cortar da face = `qty da linha − Excluir`, no mínimo 0. (Cada face aparece uma vez por caixa.)
- A interface mostra a linha expandida com as faces, o total, "Excluir" e "A cortar", com botões de mais e menos; um
  botão zera o "Excluir" da linha.
- O plano de corte e o CSV usam o **restante**. Linhas sem nada a produzir saem do plano.
- O valor é salvo no projeto (localStorage e JSON).

O conjunto de peças do plano muda a cada ajuste. O plano já recalcula quando a lista é editada.

## 4. Modelo proposto

```
Material      { nome }                       lista de nomes, com um padrão ("MDF")
Textura       { nome }                       lista de nomes; "qualquer" é um valor da face, não da chapa
Chapa         { id, material, textura, espessura, largura, altura, qtd, veio }
                                              qtd: número, ou ilimitada; veio: nenhum, horizontal, vertical
Face          { ...atual, material, espessura, textura | "qualquer" }   herda da caixa, pode sobrescrever
Caixa         { ...atual, material, espessura, textura }
Linha de corte{ id, nome, qtd, box, excluir: { faceKey: n } }
Trabalho      { chapas[], gap, margem, ... }   substitui sheetW/sheetH únicos
```

Pontos de compatibilidade a preservar:

- Projetos antigos (JSON e localStorage): criar material e textura padrão a partir de `t` e uma chapa ilimitada a partir de
  `sheetW`/`sheetH`/`grain`.
- Com um só material e uma só chapa ilimitada, o plano e os arquivos exportados devem ser **idênticos** aos de hoje.
- CSV continua no formato do Cutlist Optimizer, com colunas de material, textura e espessura quando houver mais de um.
- Cor no 3D continua como hoje, independente (D3).

## 5. Fases sugeridas

| Fase | Entrega | Mexe em | Risco |
|---|---|---|---|
| A (**feita**) | **Contador por face na lista de corte** (descontar peças feitas); plano e CSV usam o restante | app.js, lista, `planContext` | baixo |
| B | **Material, textura e espessura por face** (com a mesma espessura na caixa toda), textura "qualquer"; plano agrupa por esses campos; projeto padrão sem configuração (D7) | modelo, UI, `planContext` | médio |
| C | **Cadastro de chapas** de várias medidas, estoque ilimitado ou limitado, veio por chapa, aviso "faltam x m²" | motor (`plan.js`, validação), UI | alto |
| D | **Espessura diferente por face**, com encaixe derivado, com todas as faces levando dentes (etapa 1) | `build()`, `outerDims`, junções, tests | alto |
| E | **Dentes por face** (etapa 2): leva ou não, externo ou interno, validação de conflitos, faces sem corte | `build()`, UI, validação, tests | alto |

A e B não dependem uma da outra. C depende de B. D depende de B e é independente de C. E depende de D.

**Começar pela Fase A**, porque é a que mais falta hoje, é independente e tem risco baixo. (Feita.)

**Testes em cada fase.** Cada fase traz seus testes no mesmo commit, e a lógica nova vai para módulos sem DOM, como
`cutlist.js`, para ser testada em Node. A Fase B é a primeira a criar telas novas (material, textura e espessura por
face): antes de terminá-la, montar os **testes de navegador** descritos em [testes.md](testes.md).

## 6. Perguntas em aberto

Nenhuma pergunta bloqueia as fases A a D. Itens adiados de propósito:

**P1. Regras da etapa 2 dos dentes (D12).** Combinações válidas por aresta, quem vence quando duas faces externas
disputam o mesmo canto e como avisar de combinação impossível. Serão decididas na implementação da Fase E.

**P2. Faces sem corte a laser** (tela, vidro pronto): como aparecem no plano, no CSV e nas medidas. Também fica
para a Fase E.

## 7. Fora do escopo por enquanto

- Tipo de dente por aresta além do descrito na etapa 2 (D1).
- Custos, preço por chapa e orçamento.
- Trajetória do laser e fusão de linhas (já fora do motor).
- Nesting poligonal (previsto em [motor.md](motor.md)).
