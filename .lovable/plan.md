## Objetivo

Deixar o gráfico do bloco "Consumo médio semanal" (na página do insumo) fácil de ler num relance: hoje ele mistura linha de estoque, linha de variação tracejada num eixo oculto e pontos vermelhos, o que polui e não responde à pergunta principal — "quanto desse insumo saiu por dia/semana".

## O que muda

**Bloco superior (KPIs)**
- Mantém o título e o seletor 30/60/90 dias.
- Substitui o número grande único por 3 métricas compactas lado a lado:
  - Média/dia
  - Média/semana (destaque)
  - Dia da semana com maior consumo (ex.: "Sex • 4,2 un")

**Gráfico principal — barras de consumo diário**
- Troca o `LineChart` estoque+delta por um `BarChart` do consumo diário (saídas + produção — mesma série `delta` invertida em positivo).
- Barras em `--primary` com opacidade suave; barra do dia com maior valor destacada em `--accent`.
- `ReferenceLine` horizontal na média diária do período, rotulada "média".
- Eixo Y único, com unidade do insumo no tooltip.
- Eixo X com rótulos rotacionados só quando necessário (30d mostra todos, 60/90d agrupa a cada N).
- Altura sobe para `h-64` e margens ajustadas para não cortar rótulos.
- Estado vazio: se não houver consumo no período, mostra placeholder "Sem saídas registradas nos últimos {period} dias" no lugar do gráfico.

**Mini-gráfico secundário — estoque ao longo do tempo**
- Abaixo do gráfico de barras, uma `sparkline` fina (h-16, `LineChart` sem eixos, só tooltip) do saldo de estoque no mesmo período. Preserva a informação de tendência de estoque sem competir visualmente com o consumo.

**Legenda / rodapé**
- Remove os "pontos vermelhos de maior variação" (informação redundante com a barra destacada).
- Legenda enxuta: "Barras: consumo diário • Linha: média do período • Sparkline: estoque".

## Detalhes técnicos

Arquivo único: `src/routes/_authenticated/ingredients.$id.tsx`.

- Derivar `dailyConsumption = days.map(d => ({ ...d, out: Math.max(0, -d.delta) }))` a partir dos dados já calculados (`days` já existe).
- Calcular:
  - `avgPerDay = sum(out)/days.length`
  - `dowAverages`: média por dia da semana → escolher o maior para o KPI "dia mais forte".
  - `peakDay`: maior `out` do período para colorir a barra destacada (via `<Cell>` do recharts).
- Imports adicionais do recharts já em uso: `BarChart`, `Bar`, `Cell`, `ReferenceLine`. Remover `ReferenceDot` do import se não for mais usado.
- Tokens: usar `hsl(var(--primary))`, `hsl(var(--accent))`, `hsl(var(--muted-foreground))`, `hsl(var(--border))` — nada hardcoded.
- Tooltip formata número com `toLocaleString("pt-BR", { maximumFractionDigits: 2 })` + `data.unit`.
- Sem alterações em dados/servidor/schema.

## Fora de escopo

- Previsão de ruptura no gráfico, comparação com período anterior e agregação semanal (podem entrar num próximo passo se você quiser).
- Qualquer mudança nos demais blocos da página do insumo.
