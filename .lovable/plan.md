
# Fase 1 — Fundação: Estoque Restaurante

App de gestão de estoque mobile-first para pequenos restaurantes/bares. Esta fase entrega a base: autenticação multi-tenant, CRUD de insumos e registro de compras com atualização de estoque e custo médio.

Observação: o PDF anexado não foi recebido como arquivo — apenas o texto do PRD foi colado no prompt. O plano abaixo segue o conteúdo textual do PRD. Se houver um PDF adicional com mais detalhes, anexe antes da implementação.

## Stack
- TanStack Start (React 19 + Vite) — template atual do projeto
- Tailwind v4 + shadcn/ui (já instalados)
- Lovable Cloud (Supabase) para auth, Postgres e RLS
- Mobile-first responsivo (PWA-ready)

## Modelo de dados (Fase 1)

```text
restaurants (id, name, created_at)
profiles    (id=auth.uid, restaurant_id, full_name, role)
user_roles  (id, user_id, role enum: owner|manager|staff)
ingredients (id, restaurant_id, name, unit, current_stock,
             avg_cost, last_cost, min_stock, category, created_at)
purchases   (id, restaurant_id, ingredient_id, quantity, unit_cost,
             total_cost, supplier, purchased_at, created_by)
```

Regras chave:
- RLS em todas as tabelas: usuário só vê dados do próprio `restaurant_id`.
- Função `has_role(user_id, role)` security definer (sem recursão).
- Trigger em `purchases` (after insert): atualiza `current_stock` (soma quantidade) e recalcula `avg_cost` como média ponderada.
- Trigger `on_auth_user_created`: cria `profile` automaticamente.

## Rotas (file-based, TanStack)

```text
src/routes/
  index.tsx              → landing/redirect para /dashboard ou /login
  login.tsx              → email+senha + Google
  signup.tsx             → cria restaurante + 1º usuário (owner)
  _authenticated.tsx     → guard (beforeLoad)
  _authenticated/
    dashboard.tsx        → cards resumo (qtd insumos, estoque baixo)
    ingredients.index.tsx     → lista com busca/filtro
    ingredients.new.tsx       → form criar
    ingredients.$id.tsx       → detalhe + editar + deletar
    purchases.index.tsx       → histórico de compras
    purchases.new.tsx         → registrar entrada
```

## Componentes principais
- `AppShell` — header + bottom nav mobile / sidebar desktop
- `IngredientForm`, `IngredientCard`, `IngredientList`
- `PurchaseForm` (seleciona insumo, qtd, preço unitário, fornecedor)
- `StockBadge` (verde/amarelo/vermelho conforme `min_stock`)
- `EmptyState`, `ConfirmDialog`

## Fluxos de usuário (Fase 1)
1. Cadastro → cria `restaurant` + `profile` owner → login automático → dashboard.
2. Login → guard valida sessão → dashboard.
3. Criar insumo → aparece em /ingredients com estoque 0.
4. Registrar compra → trigger atualiza `current_stock` e `avg_cost` → visível em /ingredients.
5. Editar/excluir insumo (apenas owner/manager via RLS+role).

## Design
Mobile-first, paleta calorosa (terracotta/sage) condizente com food service, tipografia legível (DM Serif Display + Inter ou similar). Cards com sombras suaves, badges de estoque destacados. Tokens em `src/styles.css` via oklch.

## Entregáveis Fase 1
- [ ] Habilitar Lovable Cloud
- [ ] Migration: tabelas + RLS + triggers + função `has_role`
- [ ] Auth (email/senha + Google) + páginas login/signup
- [ ] Guard `_authenticated` + cache invalidation no `onAuthStateChange`
- [ ] AppShell responsivo com navegação
- [ ] CRUD completo de Insumos
- [ ] Registro de Compras com baixa automática e custo médio
- [ ] Dashboard inicial com KPIs simples

## Fora do escopo (próximas fases)
Fichas técnicas, produção com baixa automática, inventário, integração PDV, relatórios avançados, alertas — conforme Fases 2–4 do PRD.

## Próximo passo
Confirme o plano para eu habilitar o Lovable Cloud e começar pela migration + auth. Quer que eu apresente 2–3 direções visuais (paleta/tipografia/layout) antes de codar?
