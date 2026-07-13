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
      active_searches: {
        Row: {
          comunidade: string | null
          consultor_nome: string | null
          consultor_telefone: string | null
          contact_email: string | null
          contact_grupo: string | null
          contact_nome: string | null
          contact_telefone: string | null
          created_at: string
          criteria: Json
          data_origem: string | null
          data_publicacao: string | null
          decision_reason: string | null
          dedup_key: string | null
          expires_at: string
          flagged_for_review: boolean
          grupo_whatsapp: string | null
          hora_origem: string | null
          id: string
          import_batch_id: string | null
          last_match_at: string | null
          matches_count: number
          merged_from_count: number
          origem: string
          proximity: Json | null
          resumo: string | null
          similarity_score: number | null
          texto_original: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          comunidade?: string | null
          consultor_nome?: string | null
          consultor_telefone?: string | null
          contact_email?: string | null
          contact_grupo?: string | null
          contact_nome?: string | null
          contact_telefone?: string | null
          created_at?: string
          criteria: Json
          data_origem?: string | null
          data_publicacao?: string | null
          decision_reason?: string | null
          dedup_key?: string | null
          expires_at: string
          flagged_for_review?: boolean
          grupo_whatsapp?: string | null
          hora_origem?: string | null
          id?: string
          import_batch_id?: string | null
          last_match_at?: string | null
          matches_count?: number
          merged_from_count?: number
          origem?: string
          proximity?: Json | null
          resumo?: string | null
          similarity_score?: number | null
          texto_original?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          comunidade?: string | null
          consultor_nome?: string | null
          consultor_telefone?: string | null
          contact_email?: string | null
          contact_grupo?: string | null
          contact_nome?: string | null
          contact_telefone?: string | null
          created_at?: string
          criteria?: Json
          data_origem?: string | null
          data_publicacao?: string | null
          decision_reason?: string | null
          dedup_key?: string | null
          expires_at?: string
          flagged_for_review?: boolean
          grupo_whatsapp?: string | null
          hora_origem?: string | null
          id?: string
          import_batch_id?: string | null
          last_match_at?: string | null
          matches_count?: number
          merged_from_count?: number
          origem?: string
          proximity?: Json | null
          resumo?: string | null
          similarity_score?: number | null
          texto_original?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      buyer_clients: {
        Row: {
          andar_min: number | null
          area_min: number | null
          ativo: boolean
          budget_max: number | null
          budget_min: number | null
          created_at: string
          elevador_obrigatorio: boolean
          email: string | null
          finalidade: Database["public"]["Enums"]["finalidade_tipo"]
          garagem_obrigatoria: boolean
          id: string
          nome: string
          notas: string | null
          proximity: Json | null
          quartos_min: number | null
          telefone: string | null
          tipo_imovel: string[] | null
          tipologia: string | null
          updated_at: string
          user_id: string
          zona: string | null
        }
        Insert: {
          andar_min?: number | null
          area_min?: number | null
          ativo?: boolean
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          elevador_obrigatorio?: boolean
          email?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          garagem_obrigatoria?: boolean
          id?: string
          nome: string
          notas?: string | null
          proximity?: Json | null
          quartos_min?: number | null
          telefone?: string | null
          tipo_imovel?: string[] | null
          tipologia?: string | null
          updated_at?: string
          user_id: string
          zona?: string | null
        }
        Update: {
          andar_min?: number | null
          area_min?: number | null
          ativo?: boolean
          budget_max?: number | null
          budget_min?: number | null
          created_at?: string
          elevador_obrigatorio?: boolean
          email?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          garagem_obrigatoria?: boolean
          id?: string
          nome?: string
          notas?: string | null
          proximity?: Json | null
          quartos_min?: number | null
          telefone?: string | null
          tipo_imovel?: string[] | null
          tipologia?: string | null
          updated_at?: string
          user_id?: string
          zona?: string | null
        }
        Relationships: []
      }
      functional_zones: {
        Row: {
          aliases: string[]
          approved: boolean
          coverage: Json
          created_at: string
          created_by: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          approved?: boolean
          coverage?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          approved?: boolean
          coverage?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_opportunities: {
        Row: {
          active_search_id: string
          categories: Json | null
          created_at: string
          id: string
          property_id: string
          reasons: Json | null
          score: number
          updated_at: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          active_search_id: string
          categories?: Json | null
          created_at?: string
          id?: string
          property_id: string
          reasons?: Json | null
          score: number
          updated_at?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          active_search_id?: string
          categories?: Json | null
          created_at?: string
          id?: string
          property_id?: string
          reasons?: Json | null
          score?: number
          updated_at?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_opportunities_active_search_id_fkey"
            columns: ["active_search_id"]
            isOneToOne: false
            referencedRelation: "active_searches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_opportunities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      match_states: {
        Row: {
          buyer_ref: string
          buyer_source: string
          created_at: string
          id: string
          property_id: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          buyer_ref: string
          buyer_source: string
          created_at?: string
          id?: string
          property_id: string
          state: string
          updated_at?: string
          user_id: string
        }
        Update: {
          buyer_ref?: string
          buyer_source?: string
          created_at?: string
          id?: string
          property_id?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_states_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_listings: {
        Row: {
          andar: number | null
          area_m2: number | null
          casas_banho: number | null
          concelho: string | null
          created_at: string
          descricao: string | null
          finalidade: Database["public"]["Enums"]["finalidade_tipo"]
          id: string
          imagem_url: string | null
          portal: string | null
          preco: number | null
          preco_anterior: number | null
          quartos: number | null
          raw_extract: Json | null
          tem_elevador: boolean | null
          tem_garagem: boolean | null
          tipo_imovel: string | null
          tipologia: string | null
          titulo: string | null
          ultima_verificacao: string
          updated_at: string
          url: string
          user_id: string
          zona: string | null
        }
        Insert: {
          andar?: number | null
          area_m2?: number | null
          casas_banho?: number | null
          concelho?: string | null
          created_at?: string
          descricao?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          id?: string
          imagem_url?: string | null
          portal?: string | null
          preco?: number | null
          preco_anterior?: number | null
          quartos?: number | null
          raw_extract?: Json | null
          tem_elevador?: boolean | null
          tem_garagem?: boolean | null
          tipo_imovel?: string | null
          tipologia?: string | null
          titulo?: string | null
          ultima_verificacao?: string
          updated_at?: string
          url: string
          user_id: string
          zona?: string | null
        }
        Update: {
          andar?: number | null
          area_m2?: number | null
          casas_banho?: number | null
          concelho?: string | null
          created_at?: string
          descricao?: string | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          id?: string
          imagem_url?: string | null
          portal?: string | null
          preco?: number | null
          preco_anterior?: number | null
          quartos?: number | null
          raw_extract?: Json | null
          tem_elevador?: boolean | null
          tem_garagem?: boolean | null
          tipo_imovel?: string | null
          tipologia?: string | null
          titulo?: string | null
          ultima_verificacao?: string
          updated_at?: string
          url?: string
          user_id?: string
          zona?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          agency: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          agency?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          agency?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          area_bruta_m2: number | null
          area_m2: number | null
          area_terreno_m2: number | null
          area_util_m2: number | null
          ativo: boolean
          caracteristicas: string | null
          casas_banho: number | null
          concelho: string | null
          created_at: string
          descricao: string | null
          distrito: string | null
          elevador: boolean | null
          finalidade: Database["public"]["Enums"]["finalidade_tipo"]
          freguesia: string | null
          garagem: boolean | null
          id: string
          jardim: boolean | null
          piscina: boolean | null
          preco: number
          quartos: number | null
          referencia: string | null
          subtipo_imovel: string | null
          tipo_imovel: string | null
          tipologia: string
          updated_at: string
          user_id: string
          zona: string
        }
        Insert: {
          area_bruta_m2?: number | null
          area_m2?: number | null
          area_terreno_m2?: number | null
          area_util_m2?: number | null
          ativo?: boolean
          caracteristicas?: string | null
          casas_banho?: number | null
          concelho?: string | null
          created_at?: string
          descricao?: string | null
          distrito?: string | null
          elevador?: boolean | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          freguesia?: string | null
          garagem?: boolean | null
          id?: string
          jardim?: boolean | null
          piscina?: boolean | null
          preco: number
          quartos?: number | null
          referencia?: string | null
          subtipo_imovel?: string | null
          tipo_imovel?: string | null
          tipologia: string
          updated_at?: string
          user_id: string
          zona: string
        }
        Update: {
          area_bruta_m2?: number | null
          area_m2?: number | null
          area_terreno_m2?: number | null
          area_util_m2?: number | null
          ativo?: boolean
          caracteristicas?: string | null
          casas_banho?: number | null
          concelho?: string | null
          created_at?: string
          descricao?: string | null
          distrito?: string | null
          elevador?: boolean | null
          finalidade?: Database["public"]["Enums"]["finalidade_tipo"]
          freguesia?: string | null
          garagem?: boolean | null
          id?: string
          jardim?: boolean | null
          piscina?: boolean | null
          preco?: number
          quartos?: number | null
          referencia?: string | null
          subtipo_imovel?: string | null
          tipo_imovel?: string | null
          tipologia?: string
          updated_at?: string
          user_id?: string
          zona?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_phone_pt: { Args: { raw: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
      finalidade_tipo: "venda" | "arrendamento"
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
      app_role: ["admin", "user"],
      finalidade_tipo: ["venda", "arrendamento"],
    },
  },
} as const
