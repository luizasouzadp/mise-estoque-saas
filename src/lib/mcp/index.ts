import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listIngredients from "./tools/list-ingredients";
import listRecipes from "./tools/list-recipes";
import getRecipe from "./tools/get-recipe";
import recordStockMovement from "./tools/record-stock-movement";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mise-mcp",
  title: "Mise — Estoque & Fichas",
  version: "0.1.0",
  instructions:
    "Ferramentas do Mise (gestão de restaurante): consultar insumos e estoque, listar e detalhar fichas técnicas com custos calculados, e registrar movimentações de estoque. Todas as chamadas operam sobre o restaurante do usuário autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listIngredients, listRecipes, getRecipe, recordStockMovement],
});
