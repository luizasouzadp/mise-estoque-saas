# Controle de Estoque

🚀 **IMPORTANTE - LEIA ANTES DE COMEÇAR**

⚠️ **ATENÇÃO LOVABLE AI**: Este prompt contém instruções críticas. Siga EXATAMENTE o protocolo abaixo.

═══════════════════════════════════════════════════════════════

📦 **PROJETO**: O usuário deseja criar um aplicativo de gerenciamento de estoque para seu pequeno restaurante/bar. O app deve permitir o controle de insumos para pré-preparos e molhos, com baixa automática e inventário semanal. As funcionalidades incluem entrada de compras, cálculo de preço médio, histórico de consumo, análise de dados de insumos, cálculo de ficha técnica e preço de venda de pratos, e integração com PDV para controle de perdas e desperdícios. O diferencial é o acesso móvel com dados atualizados e análises detalhadas.

📋 **Resumo Executivo:**

O usuário deseja criar um aplicativo de gerenciamento de estoque para seu pequeno restaurante/bar. O app deve permitir o controle de insumos para pré-preparos e molhos, com baixa automática e inventário semanal. As funcionalidades incluem entrada de ...

═══════════════════════════════════════════════════════════════

🔴 **CHECKLIST OBRIGATÓRIO - CONFIRME ANTES DE PROSSEGUIR:**

[ ] ✅ PDF do PRD está anexado nesta conversa?

[ ] ✅ Consigo visualizar e ler o conteúdo do PDF?

[ ] ✅ O PDF contém especificações técnicas detalhadas?

═══════════════════════════════════════════════════════════════

⚠️ **PROTOCOLO DE VERIFICAÇÃO DO PDF:**

SE O PDF NÃO ESTIVER ANEXADO OU NÃO PUDER SER LIDO:

❌ NÃO prossiga com a implementação

❌ NÃO faça suposições sobre requisitos

❌ NÃO crie código baseado apenas neste prompt

✅ RESPONDA EXATAMENTE:

"🚫 **PDF NÃO DETECTADO**

Não consigo localizar o PDF do PRD anexado. Para garantir uma implementação precisa e completa, preciso que você:

1. Anexe o arquivo PDF do PRD nesta conversa

2. Confirme que o arquivo foi carregado

3. Aguarde minha confirmação de leitura

Sem o PRD completo, não posso iniciar a implementação corretamente."

═══════════════════════════════════════════════════════════════

✅ **SE O PDF ESTIVER ANEXADO E LEGÍVEL:**

🎯 **INSTRUÇÕES DE IMPLEMENTAÇÃO:**

1. **ANÁLISE INICIAL**: Leia o PRD completo e me apresente:

   - Resumo da arquitetura proposta

   - Stack técnica (usar React + TypeScript + Tailwind + Supabase)

   - Estrutura de fases do roadmap

2. **FASE 1 - FUNDAÇÃO**: Começaremos pela Fase 1 conforme especificado no PRD:

   - Configuração da arquitetura base

   - Setup de autenticação e banco de dados

   - Estrutura de componentes principais

3. **PRÓXIMOS PASSOS**: Aguardar confirmação antes de cada fase subsequente

═══════════════════════════════════════════════════════════════

📎 **ARQUIVO NECESSÁRIO**: PRD-Completo.pdf (DEVE estar anexado abaixo)

🤖 **Lovable AI**: Confirme a leitura do PDF antes de prosseguir.

═══════════════════════════════════════════════════════════════

# DOCUMENTO PRD COMPLETO

# PRD Básico: App de Gestão de Estoque para Restaurantes

**Versão:** 1.0  

**Data:** 23 de maio de 2024  

**Status:** Rascunho Inicial  

**Autor:** Product Manager AI

> **Nota:** Este é um Documento de Requisitos de Produto (PRD) básico, projetado para fornecer uma visão geral e um ponto de partida para a Fase 1. Ele define **O QUÊ** será construído, mas não **COMO** será implementado em detalhes.

---

## 1. Visão Geral do Produto

### Descrição concisa

Este é um aplicativo móvel de gestão de estoque projetado para pequenos restaurantes e bares. A ferramenta permite o controle preciso de insumos, com um foco especial em itens de pré-preparo (como molhos), automatizando a baixa de ingredientes após a produção. O app simplifica o inventário semanal, rastreia compras, calcula o custo de pratos (ficha técnica) e se integra ao PDV para identificar perdas e otimizar a rentabilidade do negócio.

### Público-alvo

Proprietários e gerentes de pequenos estabelecimentos de food service (bares de tapas, pizzarias, hamburguerias) com equipes enxutas (aprox. 6 funcionários). Esses usuários precisam de uma solução ágil e acessível pelo celular para substituir planilhas complexas ou controles manuais ineficientes.

### Proposta de valor única

*   **Controle de Pré-Preparos:** Automatiza a baixa de múltiplos ingredientes ao registrar a produção de um único item (ex: molho especial).

*   **Análise de Custo e Rentabilidade:** Calcula o custo real de cada prato via fichas técnicas e ajuda a definir preços de venda lucrativos.

*   **Identificação de Perdas:** Integra-se ao sistema de vendas (PDV) para comparar o consumo teórico com o real, expondo desperdícios.

*   **Gestão na Palma da Mão:** Todas as funcionalidades essenciais (inventário, compras, produção) acessíveis via celular.

*   **Decisões Baseadas em Dados:** Fornece histórico de consumo e preço médio para otimizar as compras e o planejamento.

---

## 2. Objetivos de Negócio (Resumo)

### Objetivo primário

Reduzir o desperdício de insumos e otimizar a margem de lucro dos pratos através de um controle de estoque preciso, cálculo de ficha técnica e análise de perdas.

### KPIs principais

*   Custo de Mercadoria Vendida (CMV)

*   Taxa de Desperdício/Perda de Insumos

*   Acuracidade do Inventário

*   Tempo Gasto na Realização de Inventário

*   Adoção do App (Usuários Ativos Semanais)

---

## 3. Funcionalidades - Visão Macro (MoSCoW)

A seguir, uma lista de alto nível das funcionalidades planejadas.

> 💡 *O PRD Completo detalha cada uma dessas funcionalidades com fluxos, regras de negócio, validações e critérios de aceitação.*

### MUST HAVE (Essencial para a Fase 1 e 2)

*   **Lançamento de Produção:** Registrar a produção de itens compostos (molhos, massas) e dar baixa automática nos ingredientes.

*   **Contagem de Inventário:** Realizar contagens de estoque (semanais/mensais) para ajustar as quantidades e registrar perdas.

*   **Entrada de Insumos:** Registrar compras de insumos, atualizando estoque, preço de custo e fornecedor.

*   **Criação de Ficha Técnica:** Cadastrar os ingredientes e quantidades de cada prato para calcular o custo de produção.

### SHOULD HAVE (Importante, a ser desenvolvido após o `MUST`)

*   **Visualização de Estoque:** Painel para ver a quantidade atual de cada insumo em tempo real.

*   **Histórico de Consumo:** Relatório de movimentação de cada insumo para análise de consumo.

*   **Análise Detalhada de Insumos:** Tela com dados consolidados de um insumo (valor médio, última compra, etc.).

*   **Integração com PDV:** Conectar ao sistema de vendas para comparar insumos baixados vs. pratos vendidos.

### COULD HAVE (Desejável, se houver tempo/recursos)

*   *Não especificado nesta fase.*

### WON'T HAVE (Fora do escopo inicial)

*   *Não especificado nesta fase.*

---

## 4. Histórias de Usuário (Simplificadas)

Estas são as jornadas principais que o usuário realizará no aplicativo.

1.  **Como um cozinheiro,** quero registrar a produção de um molho para que os ingredientes sejam baixados do estoque automaticamente, sem precisar fazer a baixa manual de cada item.

2.  **Como um gerente,** quero realizar o inventário semanal pelo celular para ajustar o estoque real e identificar discrepâncias rapidamente.

3.  **Como o responsável pelas compras,** quero registrar a entrada de uma nota fiscal de insumos para manter o estoque e o custo médio dos produtos sempre atualizados.

4.  **Como um chef,** quero criar e editar fichas técnicas detalhadas para calcular o custo exato de cada prato e ajudar a definir um preço de venda lucrativo.

5.  **Como o dono do restaurante,** quero comparar as vendas do meu PDV com o consumo de estoque para identificar onde estamos perdendo dinheiro com desperdício.

6.  **Como um gerente,** quero consultar o histórico de consumo de um insumo específico para planejar melhor as próximas compras e evitar falta de produto.

7.  **Como um funcionário,** quero visualizar rapidamente a quantidade disponível de um insumo para saber se preciso solicitar uma nova compra ou produção.

---

## 5. Arquitetura de Alto Nível (Conceitual)

### Diagrama Textual de Entidades

`Restaurante` → `Funcionário (Usuário)` → `Insumo` → `Compra`

`Restaurante` → `Ficha Técnica` → `Prato`

`Restaurante` → `Produção` (Usa `Insumos`)

`Restaurante` → `Inventário` (Ajusta `Insumos`)

### Tabelas Necessárias (Visão Geral)

*   `restaurants`: Armazena os dados de cada restaurante cliente (plano, configurações).

*   `users`: Gerencia os logins e permissões dos funcionários de cada restaurante.

*   `ingredients`: Catálogo de todos os insumos, com unidade de medida e estoque atual.

*   `purchases`: Registra cada compra de insumo, incluindo fornecedor, quantidade e preço.

*   `recipes`: Armazena as fichas técnicas, ligando pratos a uma lista de insumos e suas quantidades.

*   `productions`: Registra cada evento de produção de um item de pré-preparo.

*   `inventory_counts`: Salva os resultados de cada contagem de inventário realizada.

> 💡 *O PRD Completo inclui os schemas SQL detalhados, com tipos de dados, relacionamentos, RLS policies e triggers para automação.*

---

## 6. Stack Tecnológica Recomendada

*   **Frontend (Mobile):** React Native (para app nativo) ou Next.js (para PWA).

*   **Backend & Banco de Dados:** Supabase (PostgreSQL, Autenticação, Storage, Edge Functions).

*   **UI Library:** NativeBase (para React Native) ou Shadcn UI/TailwindCSS (para web).

*   **Hospedagem:** Vercel (para PWA) ou lojas de aplicativos (para nativo).

---

## ✅ FASE 1 - FUNDAÇÃO (Direcionamento Inicial)

Esta fase foca em construir o alicerce da aplicação, permitindo as operações mais básicas de controle de insumos.

### 6.1. O que será construído na Fase 1

1.  **Configuração do Projeto:** Setup do ambiente de desenvolvimento e do projeto Supabase (banco de dados, autenticação).

2.  **Sistema de Autenticação:** Fluxo de login e cadastro para funcionários, com associação a um restaurante.

3.  **Tabelas Base do Banco:** Criação das tabelas iniciais (`users`, `restaurants`, `ingredients`).

4.  **CRUD de Insumos:** Funcionalidade completa para Criar, Ler, Atualizar e Deletar insumos no estoque.

5.  **Layout Principal da Aplicação:** Estrutura de navegação básica com menu e telas principais.

6.  **Registro de Compras (Entrada):** Formulário simples para registrar a entrada de insumos, atualizando a quantidade em estoque.

### 6.2. Páginas da Fase 1

*   **Página de Login:** Para autenticação dos usuários.

*   **Dashboard (Inicial):** Uma tela principal simples que dará acesso às outras áreas.

*   **Página de Estoque/Insumos:** Lista todos os insumos cadastrados com a quantidade atual.

*   **Página de Novo Insumo:** Formulário para cadastrar um novo insumo.

*   **Página de Entrada de Compra:** Formulário para registrar a chegada de novos produtos.

### 6.3. Tabelas Base (Apenas Nomes)

*   `users`: Gerencia os dados e a autenticação dos funcionários.

*   `restaurants`: Isola os dados de cada cliente (essencial para um SaaS).

*   `ingredients`: O coração do sistema, armazena o catálogo de insumos.

### 6.4. Próximos Passos Sugeridos

1.  Configurar o projeto no Supabase e definir as RLS (Row Level Security) básicas para isolamento de dados por restaurante.

2.  Implementar o fluxo de autenticação (login/cadastro) usando Supabase Auth.

3.  Desenvolver a interface e a lógica para o CRUD (Create, Read, Update, Delete) de Insumos.

4.  Construir o formulário de "Entrada de Compras" para permitir a atualização do estoque.

---

## 🚀 FASES 2, 3 e 4 - VISÃO GERAL

### Fase 2 - Core Features

*   Implementar o módulo de **Fichas Técnicas**.

*   Desenvolver o fluxo de **Lançamento de Produção** com baixa automática.

*   Criar a funcionalidade de **Inventário Semanal** para ajuste de estoque.

*   Construir a tela de **Visualização de Estoque** com busca e filtros.

### Fase 3 - Funcionalidades Avançadas

*   Desenvolver a **Integração com PDV** para importação de dados de vendas.

*   Criar o painel de **Análise de Perdas** (Consumo Real vs. Teórico).

*   Implementar relatórios de **Histórico de Consumo** por insumo.

*   Criar a tela de **Análise Detalhada de Insumos** (custo médio, último fornecedor, etc.).

### Fase 4 - Polimento e Escala

*   Implementar sistema de **Alertas de Estoque Baixo**.

*   Desenvolver um módulo básico de **Gestão de Fornecedores**.

*   Melhorar os relatórios com gráficos e dashboards mais visuais.

*   Otimizar a performance para restaurantes com grande volume de dados.

---

## 🔒 QUER O PLANEJAMENTO COMPLETO?

> **Este PRD Básico cobre apenas ~20% do planejamento necessário.**

>

> O **PRD Completo** inclui:

> - ✅ **15-25 Histórias de Usuário** com critérios de aceitação detalhados

> - ✅ **Schema SQL completo** de todas as tabelas com RLS policies

> - ✅ **10+ Componentes React** especificados com props e comportamentos

> - ✅ **Fluxos de usuário detalhados** com edge cases e tratamento de erros

> - ✅ **10+ Prompts Lovable** prontos para copiar e colar

> - ✅ **Requisitos de Performance** (Core Web Vitals, otimizações)

> - ✅ **Segurança e LGPD** (validações, rate limiting, privacidade)

> - ✅ **Estratégia de Testes** (unit, integration, E2E)

> - ✅ **Roadmap detalhado** fase a fase com estimativas

>

> 📞 **Adquira o PRD Completo através do link:**

> https://construtor.ericluciano.com.br/

>

> 💡 *Com o PRD Completo, você economiza semanas de planejamento e evita retrabalho.*

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://miseestoque.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b83e3f5a-55db-4acc-bbc2-a9ac7006cf1b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
