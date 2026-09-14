export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cmv_reports: {
        Row: {
          cmv_percent: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          period_end: string
          period_start: string
          restaurant_id: string
          revenue: number
          sales_data: Json | null
          theoretical_cost: number | null
          theoretical_percent: number | null
          total_cost: number
          updated_at: string
        }
        Insert: {
          cmv_percent?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          restaurant_id: string
          revenue?: number
          sales_data?: Json | null
          theoretical_cost?: number | null
          theoretical_percent?: number | null
          total_cost?: number
          updated_at?: string
        }
        Update: {
          cmv_percent?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          restaurant_id?: string
          revenue?: number
          sales_data?: Json | null
          theoretical_cost?: number | null
          theoretical_percent?: number | null
          total_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      daily_sales_consumption: {
        Row: {
          created_at: string
          daily_report_id: string
          id: string
          ingredient_id: string
          quantity_theoretical: number
          restaurant_id: string
          sales_date: string
        }
        Insert: {
          created_at?: string
          daily_report_id: string
          id?: string
          ingredient_id: string
          quantity_theoretical?: number
          restaurant_id: string
          sales_date: string
        }
        Update: {
          created_at?: string
          daily_report_id?: string
          id?: string
          ingredient_id?: string
          quantity_theoretical?: number
          restaurant_id?: string
          sales_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_sales_consumption_daily_report_id_fkey"
            columns: ["daily_report_id"]
            isOneToOne: false
            referencedRelation: "daily_sales_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_sales_consumption_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_sales_consumption_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_sales_reports: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string | null
          id: string
          mapped_count: number
          restaurant_id: string
          sales_date: string
          total_quantity: number
          total_revenue: number
          unmapped_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          mapped_count?: number
          restaurant_id: string
          sales_date: string
          total_quantity?: number
          total_revenue?: number
          unmapped_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          mapped_count?: number
          restaurant_id?: string
          sales_date?: string
          total_quantity?: number
          total_revenue?: number
          unmapped_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_sales_reports_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_group_members: {
        Row: {
          created_at: string
          group_id: string
          ingredient_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          ingredient_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          ingredient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_group_members_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_suppliers: {
        Row: {
          created_at: string
          ingredient_id: string
          is_primary: boolean
          restaurant_id: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          ingredient_id: string
          is_primary?: boolean
          restaurant_id: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          ingredient_id?: string
          is_primary?: boolean
          restaurant_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_suppliers_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_suppliers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_unit_aliases: {
        Row: {
          created_at: string
          created_by: string | null
          factor: number
          from_unit: string
          id: string
          ingredient_id: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          factor: number
          from_unit: string
          id?: string
          ingredient_id: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          factor?: number
          from_unit?: string
          id?: string
          ingredient_id?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_unit_aliases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_unit_aliases_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          avg_cost: number
          category: string | null
          composes_cmv: boolean
          created_at: string
          current_stock: number
          default_supplier_id: string | null
          group_id: string | null
          id: string
          is_active: boolean
          last_cost: number
          min_stock: number
          name: string
          restaurant_id: string
          source_recipe_id: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          avg_cost?: number
          category?: string | null
          composes_cmv?: boolean
          created_at?: string
          current_stock?: number
          default_supplier_id?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean
          last_cost?: number
          min_stock?: number
          name: string
          restaurant_id: string
          source_recipe_id?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          avg_cost?: number
          category?: string | null
          composes_cmv?: boolean
          created_at?: string
          current_stock?: number
          default_supplier_id?: string | null
          group_id?: string | null
          id?: string
          is_active?: boolean
          last_cost?: number
          min_stock?: number
          name?: string
          restaurant_id?: string
          source_recipe_id?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_default_supplier_id_fkey"
            columns: ["default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventories: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          frequency: string
          group_id: string | null
          id: string
          last_completed_at: string | null
          name: string | null
          public_token: string
          restaurant_id: string
          scheduled_for: string | null
          status: string
          time_of_day: string
          weekday: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          frequency?: string
          group_id?: string | null
          id?: string
          last_completed_at?: string | null
          name?: string | null
          public_token?: string
          restaurant_id: string
          scheduled_for?: string | null
          status?: string
          time_of_day?: string
          weekday?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          frequency?: string
          group_id?: string | null
          id?: string
          last_completed_at?: string | null
          name?: string | null
          public_token?: string
          restaurant_id?: string
          scheduled_for?: string | null
          status?: string
          time_of_day?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventories_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_groups: {
        Row: {
          created_at: string
          group_id: string
          inventory_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          inventory_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          inventory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_groups_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventories"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          counted_qty: number | null
          created_at: string
          expected_qty: number
          group_id: string | null
          id: string
          ingredient_id: string
          ingredient_name: string
          inventory_id: string
          session_id: string | null
          unit: string
        }
        Insert: {
          counted_qty?: number | null
          created_at?: string
          expected_qty?: number
          group_id?: string | null
          id?: string
          ingredient_id: string
          ingredient_name: string
          inventory_id: string
          session_id?: string | null
          unit: string
        }
        Update: {
          counted_qty?: number | null
          created_at?: string
          expected_qty?: number
          group_id?: string | null
          id?: string
          ingredient_id?: string
          ingredient_name?: string
          inventory_id?: string
          session_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inventory_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_schedules: {
        Row: {
          active: boolean
          created_at: string
          group_id: string | null
          id: string
          phone: string | null
          restaurant_id: string
          time_of_day: string
          weekday: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          group_id?: string | null
          id?: string
          phone?: string | null
          restaurant_id: string
          time_of_day?: string
          weekday: number
        }
        Update: {
          active?: boolean
          created_at?: string
          group_id?: string | null
          id?: string
          phone?: string | null
          restaurant_id?: string
          time_of_day?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_schedules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_schedules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sessions: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          group_id: string | null
          id: string
          inventory_id: string
          public_token: string
          status: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          inventory_id: string
          public_token?: string
          status?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          inventory_id?: string
          public_token?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ingredient_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sessions_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventories"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_products: {
        Row: {
          category: string | null
          cost: number
          created_at: string
          created_by: string | null
          current_price: number | null
          id: string
          items: Json
          name: string
          product_code: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          id?: string
          items?: Json
          name: string
          product_code?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          cost?: number
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          id?: string
          items?: Json
          name?: string
          product_code?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_invoices: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          image_paths: string[]
          notes: string | null
          restaurant_id: string
          status: string
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_paths?: string[]
          notes?: string | null
          restaurant_id: string
          status?: string
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          image_paths?: string[]
          notes?: string | null
          restaurant_id?: string
          status?: string
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_invoices_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_items: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          ingredient_name: string
          production_id: string
          quantity: number
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          ingredient_name: string
          production_id: string
          quantity: number
          unit: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          ingredient_name?: string
          production_id?: string
          quantity?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_items_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_items_production_id_fkey"
            columns: ["production_id"]
            isOneToOne: false
            referencedRelation: "productions"
            referencedColumns: ["id"]
          },
        ]
      }
      productions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          produced_at: string
          quantity_produced: number
          recipe_id: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          produced_at?: string
          quantity_produced: number
          recipe_id: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          produced_at?: string
          quantity_produced?: number
          recipe_id?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "productions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          is_platform_admin: boolean
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          is_platform_admin?: boolean
          restaurant_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          is_platform_admin?: boolean
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_import_matches: {
        Row: {
          created_at: string
          hits: number
          id: string
          ingredient_id: string
          last_used_at: string
          raw_text_normalized: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          hits?: number
          id?: string
          ingredient_id: string
          last_used_at?: string
          raw_text_normalized: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          hits?: number
          id?: string
          ingredient_id?: string
          last_used_at?: string
          raw_text_normalized?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_import_matches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_import_matches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          expected_at: string | null
          id: string
          import_status: string
          imported_purchase_ids: string[] | null
          ingredient_id: string
          notes: string | null
          quantity: number
          receipt_image_path: string | null
          receipt_image_paths: string[] | null
          receipt_notes: string | null
          received_at: string | null
          restaurant_id: string
          status: string
          supplier_id: string | null
          supplier_name: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          import_status?: string
          imported_purchase_ids?: string[] | null
          ingredient_id: string
          notes?: string | null
          quantity: number
          receipt_image_path?: string | null
          receipt_image_paths?: string[] | null
          receipt_notes?: string | null
          received_at?: string | null
          restaurant_id: string
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          unit: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_at?: string | null
          id?: string
          import_status?: string
          imported_purchase_ids?: string[] | null
          ingredient_id?: string
          notes?: string | null
          quantity?: number
          receipt_image_path?: string | null
          receipt_image_paths?: string[] | null
          receipt_notes?: string | null
          received_at?: string | null
          restaurant_id?: string
          status?: string
          supplier_id?: string | null
          supplier_name?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          invoice_image_path: string | null
          invoice_image_paths: string[] | null
          purchased_at: string
          quantity: number
          restaurant_id: string
          source: string
          supplier: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          invoice_image_path?: string | null
          invoice_image_paths?: string[] | null
          purchased_at?: string
          quantity: number
          restaurant_id: string
          source?: string
          supplier?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          invoice_image_path?: string | null
          invoice_image_paths?: string[] | null
          purchased_at?: string
          quantity?: number
          restaurant_id?: string
          source?: string
          supplier?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchases_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_items: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string | null
          item_type: string
          quantity: number
          recipe_id: string
          sub_recipe_id: string | null
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id?: string | null
          item_type: string
          quantity?: number
          recipe_id: string
          sub_recipe_id?: string | null
          unit?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string | null
          item_type?: string
          quantity?: number
          recipe_id?: string
          sub_recipe_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_items_sub_recipe_id_fkey"
            columns: ["sub_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string | null
          current_price: number | null
          description: string | null
          id: string
          image_url: string | null
          is_on_menu: boolean
          is_stocked: boolean
          menu_category: string | null
          name: string
          pdv_produto_id: string | null
          product_code: string | null
          restaurant_id: string
          updated_at: string
          yield_qty: number
          yield_unit: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_on_menu?: boolean
          is_stocked?: boolean
          menu_category?: string | null
          name: string
          pdv_produto_id?: string | null
          product_code?: string | null
          restaurant_id: string
          updated_at?: string
          yield_qty?: number
          yield_unit?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_on_menu?: boolean
          is_stocked?: boolean
          menu_category?: string | null
          name?: string
          pdv_produto_id?: string | null
          product_code?: string | null
          restaurant_id?: string
          updated_at?: string
          yield_qty?: number
          yield_unit?: string
        }
        Relationships: []
      }
      restaurants: {
        Row: {
          created_at: string
          id: string
          ideal_cmv: number
          name: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          ideal_cmv?: number
          name: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          ideal_cmv?: number
          name?: string
          status?: string
        }
        Relationships: []
      }
      sales_report_items: {
        Row: {
          category: string | null
          created_at: string
          id: string
          item_name: string
          margin: number
          menu_product_id: string | null
          product_code: string
          quantity: number
          recipe_id: string | null
          report_id: string
          revenue: number
          source: string
          total_cost: number
          unit_cost: number
          unit_price: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          item_name: string
          margin?: number
          menu_product_id?: string | null
          product_code: string
          quantity?: number
          recipe_id?: string | null
          report_id: string
          revenue?: number
          source: string
          total_cost?: number
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          item_name?: string
          margin?: number
          menu_product_id?: string | null
          product_code?: string
          quantity?: number
          recipe_id?: string | null
          report_id?: string
          revenue?: number
          source?: string
          total_cost?: number
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_report_items_menu_product_id_fkey"
            columns: ["menu_product_id"]
            isOneToOne: false
            referencedRelation: "menu_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_report_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_report_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "sales_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_report_unmapped: {
        Row: {
          created_at: string
          id: string
          product_code: string
          quantity: number
          report_id: string
          revenue: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_code: string
          quantity?: number
          report_id: string
          revenue?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          product_code?: string
          quantity?: number
          report_id?: string
          revenue?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_report_unmapped_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "sales_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_reports: {
        Row: {
          ai_insights: string | null
          created_at: string
          created_by: string | null
          file_name: string | null
          id: string
          reference_month: string
          restaurant_id: string
          total_cost: number
          total_margin: number
          total_quantity: number
          total_revenue: number
          updated_at: string
        }
        Insert: {
          ai_insights?: string | null
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          reference_month: string
          restaurant_id: string
          total_cost?: number
          total_margin?: number
          total_quantity?: number
          total_revenue?: number
          updated_at?: string
        }
        Update: {
          ai_insights?: string | null
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          id?: string
          reference_month?: string
          restaurant_id?: string
          total_cost?: number
          total_margin?: number
          total_quantity?: number
          total_revenue?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_reports_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          notes: string | null
          occurred_at: string
          quantity: number
          reason: string | null
          restaurant_id: string
          type: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          notes?: string | null
          occurred_at?: string
          quantity: number
          reason?: string | null
          restaurant_id: string
          type: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          notes?: string | null
          occurred_at?: string
          quantity?: number
          reason?: string | null
          restaurant_id?: string
          type?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_days: number[]
          id: string
          lead_time_days: number | null
          min_order_value: number | null
          name: string
          notes: string | null
          order_days: number[]
          phone: string | null
          restaurant_id: string
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_days?: number[]
          id?: string
          lead_time_days?: number | null
          min_order_value?: number | null
          name: string
          notes?: string | null
          order_days?: number[]
          phone?: string | null
          restaurant_id: string
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_days?: number[]
          id?: string
          lead_time_days?: number | null
          min_order_value?: number | null
          name?: string
          notes?: string | null
          order_days?: number[]
          phone?: string | null
          restaurant_id?: string
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_restaurant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      ingredient_avg_cost_last_30d: {
        Args: { _ingredient_id: string }
        Returns: number
      }
      is_manager_or_owner: { Args: { _user_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      projected_stock_for_ingredient: {
        Args: { _ingredient_id: string }
        Returns: number
      }
      projected_stock_status: {
        Args: never
        Returns: {
          anchor_at: string
          consumed_since_anchor: number
          current_stock: number
          days_since_anchor: number
          ingredient_id: string
          ingredient_name: string
          min_stock: number
          projected_stock: number
          status: string
          unit: string
        }[]
      }
      recipe_total_cost: {
        Args: { _depth?: number; _recipe_id: string }
        Returns: number
      }
      recipe_unit_cost: { Args: { _recipe_id: string }; Returns: number }
      refresh_all_stocked_ingredients: { Args: never; Returns: undefined }
      refresh_stocked_ingredient_for_recipe: {
        Args: { _recipe_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "owner" | "manager" | "staff" | "chef" | "receiver"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "manager", "staff", "chef", "receiver"],
    },
  },
} as const
