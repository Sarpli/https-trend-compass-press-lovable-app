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
      chunk_error_reports: {
        Row: {
          build_version: string | null
          client_id: string | null
          created_at: string
          id: string
          last_toast_state: string | null
          message: string | null
          online: boolean | null
          page_url: string | null
          retry_attempt: number
          route: string | null
          source_url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          build_version?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_toast_state?: string | null
          message?: string | null
          online?: boolean | null
          page_url?: string | null
          retry_attempt?: number
          route?: string | null
          source_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          build_version?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_toast_state?: string | null
          message?: string | null
          online?: boolean | null
          page_url?: string | null
          retry_attempt?: number
          route?: string | null
          source_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      chunk_errors: {
        Row: {
          build_version: string | null
          client_id: string | null
          created_at: string
          fingerprint: string | null
          id: string
          message: string | null
          page_url: string | null
          source_url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          build_version?: string | null
          client_id?: string | null
          created_at?: string
          fingerprint?: string | null
          id?: string
          message?: string | null
          page_url?: string | null
          source_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          build_version?: string | null
          client_id?: string | null
          created_at?: string
          fingerprint?: string | null
          id?: string
          message?: string | null
          page_url?: string | null
          source_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      dismissed_banners: {
        Row: {
          created_at: string
          trend_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          trend_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          trend_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_banners_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "dismissed_banners_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_trends: {
        Row: {
          created_at: string
          trend_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          trend_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          trend_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_trends_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "learned_trends_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      pro_upgrade_intent_alerts: {
        Row: {
          baseline: number
          created_at: string
          details: Json
          id: string
          kind: string
          observed: number
          ratio: number | null
          severity: string
          window_end: string
          window_start: string
        }
        Insert: {
          baseline: number
          created_at?: string
          details?: Json
          id?: string
          kind: string
          observed: number
          ratio?: number | null
          severity: string
          window_end: string
          window_start: string
        }
        Update: {
          baseline?: number
          created_at?: string
          details?: Json
          id?: string
          kind?: string
          observed?: number
          ratio?: number | null
          severity?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      pro_upgrade_intents: {
        Row: {
          category: string
          created_at: string
          direction: string | null
          id: string
          metadata: Json
          source: string
          trend_id: string | null
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          direction?: string | null
          id?: string
          metadata?: Json
          source?: string
          trend_id?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          direction?: string | null
          id?: string
          metadata?: Json
          source?: string
          trend_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pro_upgrade_intents_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "pro_upgrade_intents_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_founding_voter: boolean
          last_active_date: string | null
          last_active_local_date: string | null
          max_streak: number | null
          push_enabled: boolean
          push_reminder_hour: number
          streak_count: number
          timezone: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_founding_voter?: boolean
          last_active_date?: string | null
          last_active_local_date?: string | null
          max_streak?: number | null
          push_enabled?: boolean
          push_reminder_hour?: number
          streak_count?: number
          timezone?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_founding_voter?: boolean
          last_active_date?: string | null
          last_active_local_date?: string | null
          max_streak?: number | null
          push_enabled?: boolean
          push_reminder_hour?: number
          streak_count?: number
          timezone?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      saved_glossary: {
        Row: {
          created_at: string
          trend_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          trend_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          trend_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_glossary_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "saved_glossary_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      searches: {
        Row: {
          created_at: string
          id: string
          query: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          user_id?: string
        }
        Relationships: []
      }
      spotlight_pins: {
        Row: {
          created_at: string
          created_by: string | null
          pin_date: string
          trend_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          pin_date: string
          trend_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          pin_date?: string
          trend_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotlight_pins_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "spotlight_pins_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      streak_history: {
        Row: {
          action_date: string
          created_at: string
          id: string
          new_streak_count: number
          source: string
          user_id: string
        }
        Insert: {
          action_date: string
          created_at?: string
          id?: string
          new_streak_count: number
          source: string
          user_id: string
        }
        Update: {
          action_date?: string
          created_at?: string
          id?: string
          new_streak_count?: number
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          current_period_end: string | null
          status: string
          tier: Database["public"]["Enums"]["sub_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          status?: string
          tier?: Database["public"]["Enums"]["sub_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          status?: string
          tier?: Database["public"]["Enums"]["sub_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trend_popularity: {
        Row: {
          created_at: string
          intensity: number
          month: number
          trend_id: string
          year: number
        }
        Insert: {
          created_at?: string
          intensity: number
          month: number
          trend_id: string
          year: number
        }
        Update: {
          created_at?: string
          intensity?: number
          month?: number
          trend_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "trend_popularity_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "trend_popularity_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      trends: {
        Row: {
          base_price: number
          category: string | null
          created_at: string
          examples: Json
          featured: boolean
          id: string
          image_url: string | null
          origin: string
          origin_year: number | null
          plain_language: string
          popularity_history: Json
          safety_tips: string
          slug: string
          term: string
        }
        Insert: {
          base_price?: number
          category?: string | null
          created_at?: string
          examples?: Json
          featured?: boolean
          id?: string
          image_url?: string | null
          origin: string
          origin_year?: number | null
          plain_language: string
          popularity_history?: Json
          safety_tips: string
          slug: string
          term: string
        }
        Update: {
          base_price?: number
          category?: string | null
          created_at?: string
          examples?: Json
          featured?: boolean
          id?: string
          image_url?: string | null
          origin?: string
          origin_year?: number | null
          plain_language?: string
          popularity_history?: Json
          safety_tips?: string
          slug?: string
          term?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vote_events: {
        Row: {
          created_at: string
          id: number
          trend_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          trend_id: string
        }
        Update: {
          created_at?: string
          id?: number
          trend_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vote_events_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "vote_events_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          category: Database["public"]["Enums"]["vote_category"]
          created_at: string
          direction: Database["public"]["Enums"]["vote_direction"]
          id: string
          period_key: string
          trend_id: string
          user_id: string
          weight: number
        }
        Insert: {
          category: Database["public"]["Enums"]["vote_category"]
          created_at?: string
          direction: Database["public"]["Enums"]["vote_direction"]
          id?: string
          period_key: string
          trend_id: string
          user_id: string
          weight?: number
        }
        Update: {
          category?: Database["public"]["Enums"]["vote_category"]
          created_at?: string
          direction?: Database["public"]["Enums"]["vote_direction"]
          id?: string
          period_key?: string
          trend_id?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "votes_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trend_scores"
            referencedColumns: ["trend_id"]
          },
          {
            foreignKeyName: "votes_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "trends"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      trend_scores: {
        Row: {
          base_price: number | null
          net_votes: number | null
          price: number | null
          slug: string | null
          term: string | null
          trend_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      detect_pro_upgrade_intent_anomalies: { Args: never; Returns: number }
      get_category_vote_history: {
        Args: {
          _category: Database["public"]["Enums"]["vote_category"]
          _period_key: string
        }
        Returns: {
          score: number
          t: string
        }[]
      }
      get_effective_streak: { Args: { _local_date: string }; Returns: number }
      get_trend_price_history: {
        Args: { _trend_id: string }
        Returns: {
          price: number
          t: string
        }[]
      }
      get_trend_scores: {
        Args: never
        Returns: {
          net_votes: number
          price: number
          slug: string
          term: string
          trend_id: string
        }[]
      }
      get_vote_tallies: {
        Args: {
          _category: Database["public"]["Enums"]["vote_category"]
          _period_key: string
        }
        Returns: {
          net_votes: number
          trend_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_annual: { Args: { _user_id: string }; Returns: boolean }
      is_pro: { Args: { _user_id: string }; Returns: boolean }
      is_pro_self: { Args: never; Returns: boolean }
      mark_trend_learned: {
        Args: { _local_date: string; _trend_id: string }
        Returns: number
      }
      prune_pro_upgrade_intents: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
      sub_tier: "free" | "pro_monthly" | "pro_annual"
      vote_category: "week" | "month" | "year" | "oat"
      vote_direction: "up" | "down"
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
      sub_tier: ["free", "pro_monthly", "pro_annual"],
      vote_category: ["week", "month", "year", "oat"],
      vote_direction: ["up", "down"],
    },
  },
} as const
