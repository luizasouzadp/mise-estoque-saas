import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listIngredients from "./tools/list-ingredients";
import listRecipes from "./tools/list-recipes";
import getRecipe from "./tools/get-recipe";
import recordStockMovement from "./tools/record-stock-movement";
import getInventorySummary from "./tools/get-inventory-summary";
import getInventoryValue from "./tools/get-inventory-value";
import getProductStock from "./tools/get-product-stock";
import getLowStock from "./tools/get-low-stock";
import getOutOfStock from "./tools/get-out-of-stock";
import getProductsNearMinimum from "./tools/get-products-near-minimum";
import getStockMovements from "./tools/get-stock-movements";
import getInventorySnapshot from "./tools/get-inventory-snapshot";
import getProductConsumption from "./tools/get-product-consumption";
import getRecipeConsumption from "./tools/get-recipe-consumption";
import getConsumptionTrends from "./tools/get-consumption-trends";
import predictStockDepletion from "./tools/predict-stock-depletion";
import predictRestockDate from "./tools/predict-restock-date";
import forecastProductConsumption from "./tools/forecast-product-consumption";
import suggestPurchaseQuantity from "./tools/suggest-purchase-quantity";
import detectAbnormalConsumption from "./tools/detect-abnormal-consumption";
import detectDeadStock from "./tools/detect-dead-stock";
import analyzeInventoryHealth from "./tools/analyze-inventory-health";
import listSuppliers from "./tools/list-suppliers";
import getSupplierProducts from "./tools/get-supplier-products";
import createSupplier from "./tools/create-supplier";
import updateSupplier from "./tools/update-supplier";
import updateIngredientSupplier from "./tools/update-ingredient-supplier";
import createPurchaseSuggestion from "./tools/create-purchase-suggestion";
import createPurchaseOrder from "./tools/create-purchase-order";
import simulateRecipeProduction from "./tools/simulate-recipe-production";
import produceRecipe from "./tools/produce-recipe";
import calculateRecipeCost from "./tools/calculate-recipe-cost";
import calculateFoodCost from "./tools/calculate-food-cost";
import calculateCmv from "./tools/calculate-cmv";
import getDashboard from "./tools/get-dashboard";
import generateManagementReport from "./tools/generate-management-report";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mise-mcp",
  title: "Mise — Estoque & Fichas",
  version: "0.2.0",
  instructions:
    "Assistente inteligente de gestão de estoque para restaurantes. Ferramentas para consultar estoque e movimentações, analisar consumo, prever ruptura e sugerir compras, produzir receitas, calcular custos e CMV, e gerar dashboards e relatórios. Todas operam sobre o restaurante do usuário autenticado (RLS).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    // Existentes
    listIngredients,
    listRecipes,
    getRecipe,
    recordStockMovement,
    // Estoque
    getInventorySummary,
    getInventoryValue,
    getProductStock,
    getLowStock,
    getOutOfStock,
    getProductsNearMinimum,
    getStockMovements,
    getInventorySnapshot,
    // Consumo
    getProductConsumption,
    getRecipeConsumption,
    getConsumptionTrends,
    // Previsões
    predictStockDepletion,
    predictRestockDate,
    forecastProductConsumption,
    suggestPurchaseQuantity,
    detectAbnormalConsumption,
    detectDeadStock,
    analyzeInventoryHealth,
    // Compras
    listSuppliers,
    getSupplierProducts,
    createPurchaseSuggestion,
    createPurchaseOrder,
    // Produção
    simulateRecipeProduction,
    produceRecipe,
    // Custos
    calculateRecipeCost,
    calculateFoodCost,
    calculateCmv,
    // Inteligência
    getDashboard,
    generateManagementReport,
  ],
});
