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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounts: {
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
      appointment_types: {
        Row: {
          account_id: string
          color: string
          created_at: string
          default_price_cents: number
          duration_minutes: number
          id: string
          name: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          default_price_cents?: number
          duration_minutes?: number
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          default_price_cents?: number
          duration_minutes?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_types_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          account_id: string
          appointment_type_id: string | null
          clinic_id: string
          created_at: string
          ends_at: string
          id: string
          patient_id: string
          practitioner_id: string | null
          room_id: string | null
          starts_at: string
          status: string
        }
        Insert: {
          account_id: string
          appointment_type_id?: string | null
          clinic_id: string
          created_at?: string
          ends_at: string
          id?: string
          patient_id: string
          practitioner_id?: string | null
          room_id?: string | null
          starts_at: string
          status?: string
        }
        Update: {
          account_id?: string
          appointment_type_id?: string | null
          clinic_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          patient_id?: string
          practitioner_id?: string | null
          room_id?: string | null
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_practitioner_id_fkey"
            columns: ["practitioner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "calendar_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_resources: {
        Row: {
          account_id: string
          clinic_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          account_id: string
          clinic_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          clinic_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_resources_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          account_id: string
          address: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          account_id: string
          address?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          address?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          account_id: string
          description: string
          id: string
          invoice_id: string
          price_cents: number
          quantity: number
          service_id: string | null
        }
        Insert: {
          account_id: string
          description: string
          id?: string
          invoice_id: string
          price_cents?: number
          quantity?: number
          service_id?: string | null
        }
        Update: {
          account_id?: string
          description?: string
          id?: string
          invoice_id?: string
          price_cents?: number
          quantity?: number
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services_products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string
          appointment_id: string | null
          created_at: string
          id: string
          invoice_number: string
          patient_id: string
          status: string
          total_cents: number
        }
        Insert: {
          account_id: string
          appointment_id?: string | null
          created_at?: string
          id?: string
          invoice_number: string
          patient_id: string
          status?: string
          total_cents?: number
        }
        Update: {
          account_id?: string
          appointment_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string
          patient_id?: string
          status?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          account_id: string
          balance_cents: number
          clinic_id: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          phone: string | null
          tags: string[]
          user_id: string | null
        }
        Insert: {
          account_id: string
          balance_cents?: number
          clinic_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          phone?: string | null
          tags?: string[]
          user_id?: string | null
        }
        Update: {
          account_id?: string
          balance_cents?: number
          clinic_id?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          phone?: string | null
          tags?: string[]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          account_id: string
          amount_cents: number
          id: string
          invoice_id: string
          method: string
          paid_at: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          id?: string
          invoice_id: string
          method?: string
          paid_at?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          id?: string
          invoice_id?: string
          method?: string
          paid_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      services_products: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          price_cents: number
          tax_rate: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          price_cents?: number
          tax_rate?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          price_cents?: number
          tax_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_products_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      team_member_clinics: {
        Row: {
          clinic_id: string
          team_member_id: string
        }
        Insert: {
          clinic_id: string
          team_member_id: string
        }
        Update: {
          clinic_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_member_clinics_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_member_clinics_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          account_id: string
          color: string
          created_at: string
          full_name: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          full_name: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          full_name?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_notes: {
        Row: {
          account_id: string
          appointment_id: string
          body: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          account_id: string
          appointment_id: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          account_id?: string
          appointment_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_notes_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_account_with_owner: {
        Args: { p_account_name: string; p_clinic_name: string }
        Returns: {
          account_id: string
          clinic_id: string
        }[]
      }
      is_account_member: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      is_own_patient_account: {
        Args: { target_account_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
