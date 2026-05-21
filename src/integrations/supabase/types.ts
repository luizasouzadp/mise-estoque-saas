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
      ingredients: {
        Row: {
          avg_cost: number
          category: string | null
          created_at: string
          current_stock: number
          group_id: string | null
          id: string
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
          created_at?: string
          current_stock?: number
          group_id?: string | null
          id?: string
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
          created_at?: string
          current_stock?: number
          group_id?: string | null
          id?: string
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
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
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
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          purchased_at: string
          quantity: number
          restaurant_id: string
          supplier: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          purchased_at?: string
          quantity: number
          restaurant_id: string
          supplier?: string | null
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          purchased_at?: string
          quantity?: number
          restaurant_id?: string
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
          description: string | null
          id: string
          is_stocked: boolean
          name: string
          restaurant_id: string
          updated_at: string
          yield_qty: number
          yield_unit: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_stocked?: boolean
          name: string
          restaurant_id: string
          updated_at?: string
          yield_qty?: number
          yield_unit?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_stocked?: boolean
          name?: string
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
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
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
      recipe_total_cost: {
        Args: { _depth?: number; _recipe_id: string }
        Returns: number
      }
      recipe_unit_cost: { Args: { _recipe_id: string }; Returns: number }
    }
    Enums: {
      app_role: "owner" | "manager" | "staff"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["owner", "manager", "staff"],
    },
  },
} as const
