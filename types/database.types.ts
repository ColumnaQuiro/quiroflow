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
      account_credits: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string | null
          method: string | null
          patient_id: string
          reason: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          patient_id: string
          reason?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          method?: string | null
          patient_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_credits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_credits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_credits_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_credits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "account_credits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_credits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      account_invites: {
        Row: {
          accepted_at: string | null
          account_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          link_practitioner_name: string | null
          role: string
          role_id: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          account_id: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          link_practitioner_name?: string | null
          role?: string
          role_id?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          account_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          link_practitioner_name?: string | null
          role?: string
          role_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_invites_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_invites_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "account_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_roles: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          appointment_confirmation_channels: string[]
          appointment_confirmation_enabled: boolean
          appointment_reminder_channels: string[]
          appointment_reminder_enabled: boolean
          appointment_reminder_hours_before: number
          cancellation_fee_cents: number | null
          created_at: string
          email_confirmation_body: string | null
          email_confirmation_subject: string | null
          email_reminder_body: string | null
          email_reminder_subject: string | null
          hide_account_balance: boolean
          hide_invoice_balance: boolean
          hide_logo_on_invoices: boolean
          hide_next_visit_on_invoices: boolean
          hide_payments_on_invoices: boolean
          hide_provider_on_invoices: boolean
          id: string
          invoice_email_body: string | null
          invoice_email_subject: string | null
          missed_appointment_fee_cents: number | null
          name: string
          new_patient_field_config: Json
          next_invoice_number: number | null
          online_booking_background_color: string | null
          online_booking_gtm_id: string | null
          online_booking_hide_logo: boolean
          online_booking_max_days_ahead: number
          online_booking_notify_email: string | null
          online_booking_notify_whatsapp: string | null
          online_booking_notify_whatsapp_template_language: string
          online_booking_notify_whatsapp_template_name: string | null
          online_booking_practitioner_order: string
          online_booking_primary_color: string | null
          online_booking_referral_url: string | null
          online_booking_secondary_color: string | null
          online_booking_text_overrides: Json
          scheduling_policy_fee_cents: number | null
          send_invoices_automatically_default: boolean
          show_dob_on_invoices: boolean
          show_ssn_on_invoices: boolean
          show_taxes_on_invoices: boolean
          slug: string
          stripe_connect_account_id: string | null
          stripe_publishable_key: string | null
          stripe_secret_key: string | null
          stripe_webhook_secret: string | null
          whatsapp_access_token: string | null
          whatsapp_business_account_id: string | null
          whatsapp_confirmation_template_language: string
          whatsapp_confirmation_template_name: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_recall_template_language: string
          whatsapp_recall_template_name: string | null
          whatsapp_reminder_template_language: string | null
          whatsapp_reminder_template_name: string | null
        }
        Insert: {
          appointment_confirmation_channels?: string[]
          appointment_confirmation_enabled?: boolean
          appointment_reminder_channels?: string[]
          appointment_reminder_enabled?: boolean
          appointment_reminder_hours_before?: number
          cancellation_fee_cents?: number | null
          created_at?: string
          email_confirmation_body?: string | null
          email_confirmation_subject?: string | null
          email_reminder_body?: string | null
          email_reminder_subject?: string | null
          hide_account_balance?: boolean
          hide_invoice_balance?: boolean
          hide_logo_on_invoices?: boolean
          hide_next_visit_on_invoices?: boolean
          hide_payments_on_invoices?: boolean
          hide_provider_on_invoices?: boolean
          id?: string
          invoice_email_body?: string | null
          invoice_email_subject?: string | null
          missed_appointment_fee_cents?: number | null
          name: string
          new_patient_field_config?: Json
          next_invoice_number?: number | null
          online_booking_background_color?: string | null
          online_booking_gtm_id?: string | null
          online_booking_hide_logo?: boolean
          online_booking_max_days_ahead?: number
          online_booking_notify_email?: string | null
          online_booking_notify_whatsapp?: string | null
          online_booking_notify_whatsapp_template_language?: string
          online_booking_notify_whatsapp_template_name?: string | null
          online_booking_practitioner_order?: string
          online_booking_primary_color?: string | null
          online_booking_referral_url?: string | null
          online_booking_secondary_color?: string | null
          online_booking_text_overrides?: Json
          scheduling_policy_fee_cents?: number | null
          send_invoices_automatically_default?: boolean
          show_dob_on_invoices?: boolean
          show_ssn_on_invoices?: boolean
          show_taxes_on_invoices?: boolean
          slug: string
          stripe_connect_account_id?: string | null
          stripe_publishable_key?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_confirmation_template_language?: string
          whatsapp_confirmation_template_name?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_recall_template_language?: string
          whatsapp_recall_template_name?: string | null
          whatsapp_reminder_template_language?: string | null
          whatsapp_reminder_template_name?: string | null
        }
        Update: {
          appointment_confirmation_channels?: string[]
          appointment_confirmation_enabled?: boolean
          appointment_reminder_channels?: string[]
          appointment_reminder_enabled?: boolean
          appointment_reminder_hours_before?: number
          cancellation_fee_cents?: number | null
          created_at?: string
          email_confirmation_body?: string | null
          email_confirmation_subject?: string | null
          email_reminder_body?: string | null
          email_reminder_subject?: string | null
          hide_account_balance?: boolean
          hide_invoice_balance?: boolean
          hide_logo_on_invoices?: boolean
          hide_next_visit_on_invoices?: boolean
          hide_payments_on_invoices?: boolean
          hide_provider_on_invoices?: boolean
          id?: string
          invoice_email_body?: string | null
          invoice_email_subject?: string | null
          missed_appointment_fee_cents?: number | null
          name?: string
          new_patient_field_config?: Json
          next_invoice_number?: number | null
          online_booking_background_color?: string | null
          online_booking_gtm_id?: string | null
          online_booking_hide_logo?: boolean
          online_booking_max_days_ahead?: number
          online_booking_notify_email?: string | null
          online_booking_notify_whatsapp?: string | null
          online_booking_notify_whatsapp_template_language?: string
          online_booking_notify_whatsapp_template_name?: string | null
          online_booking_practitioner_order?: string
          online_booking_primary_color?: string | null
          online_booking_referral_url?: string | null
          online_booking_secondary_color?: string | null
          online_booking_text_overrides?: Json
          scheduling_policy_fee_cents?: number | null
          send_invoices_automatically_default?: boolean
          show_dob_on_invoices?: boolean
          show_ssn_on_invoices?: boolean
          show_taxes_on_invoices?: boolean
          slug?: string
          stripe_connect_account_id?: string | null
          stripe_publishable_key?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_confirmation_template_language?: string
          whatsapp_confirmation_template_name?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_recall_template_language?: string
          whatsapp_recall_template_name?: string | null
          whatsapp_reminder_template_language?: string | null
          whatsapp_reminder_template_name?: string | null
        }
        Relationships: []
      }
      api_tokens: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          token_prefix: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_tokens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_tokens_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      app_opens: {
        Row: {
          account_id: string
          device_id: string
          first_seen_at: string
          last_seen_at: string
          platform: string
        }
        Insert: {
          account_id: string
          device_id: string
          first_seen_at?: string
          last_seen_at?: string
          platform: string
        }
        Update: {
          account_id?: string
          device_id?: string
          first_seen_at?: string
          last_seen_at?: string
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_opens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reschedules: {
        Row: {
          account_id: string
          appointment_id: string
          created_at: string
          created_by: string | null
          fee_applied: boolean
          from_starts_at: string
          id: string
          note: string | null
          reason_id: string | null
          to_starts_at: string
        }
        Insert: {
          account_id: string
          appointment_id: string
          created_at?: string
          created_by?: string | null
          fee_applied?: boolean
          from_starts_at: string
          id?: string
          note?: string | null
          reason_id?: string | null
          to_starts_at: string
        }
        Update: {
          account_id?: string
          appointment_id?: string
          created_at?: string
          created_by?: string | null
          fee_applied?: boolean
          from_starts_at?: string
          id?: string
          note?: string | null
          reason_id?: string | null
          to_starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reschedules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedules_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedules_reason_id_fkey"
            columns: ["reason_id"]
            isOneToOne: false
            referencedRelation: "reschedule_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_type_overrides: {
        Row: {
          account_id: string
          appointment_type_id: string
          created_at: string
          duration_minutes: number | null
          id: string
          price_cents: number | null
          team_member_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          appointment_type_id: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          price_cents?: number | null
          team_member_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          appointment_type_id?: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          price_cents?: number | null
          team_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_type_overrides_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_type_overrides_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_type_overrides_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
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
          online_bookable_by: string
          online_booking_enabled: boolean
          online_bypass_practitioner: boolean
          online_deposit_cents: number | null
          online_max_days_ahead: number | null
          online_payment_required: boolean
          stage: string | null
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          default_price_cents?: number
          duration_minutes?: number
          id?: string
          name: string
          online_bookable_by?: string
          online_booking_enabled?: boolean
          online_bypass_practitioner?: boolean
          online_deposit_cents?: number | null
          online_max_days_ahead?: number | null
          online_payment_required?: boolean
          stage?: string | null
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          default_price_cents?: number
          duration_minutes?: number
          id?: string
          name?: string
          online_bookable_by?: string
          online_booking_enabled?: boolean
          online_bypass_practitioner?: boolean
          online_deposit_cents?: number | null
          online_max_days_ahead?: number | null
          online_payment_required?: boolean
          stage?: string | null
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
          checked_in_at: string | null
          clinic_id: string
          confirmation_sent_at: string | null
          confirmation_status: string | null
          created_at: string
          deleted_at: string | null
          ends_at: string
          external_reference: string | null
          flow_checkout_at: string | null
          flow_with_practitioner_at: string | null
          id: string
          note: string | null
          patient_id: string
          practitioner_id: string | null
          practitioner_name: string | null
          reminder_sent_at: string | null
          rescheduled: boolean
          room_id: string | null
          same_day_info_sent_at: string | null
          source: string
          starts_at: string
          status: string
        }
        Insert: {
          account_id: string
          appointment_type_id?: string | null
          checked_in_at?: string | null
          clinic_id: string
          confirmation_sent_at?: string | null
          confirmation_status?: string | null
          created_at?: string
          deleted_at?: string | null
          ends_at: string
          external_reference?: string | null
          flow_checkout_at?: string | null
          flow_with_practitioner_at?: string | null
          id?: string
          note?: string | null
          patient_id: string
          practitioner_id?: string | null
          practitioner_name?: string | null
          reminder_sent_at?: string | null
          rescheduled?: boolean
          room_id?: string | null
          same_day_info_sent_at?: string | null
          source?: string
          starts_at: string
          status?: string
        }
        Update: {
          account_id?: string
          appointment_type_id?: string | null
          checked_in_at?: string | null
          clinic_id?: string
          confirmation_sent_at?: string | null
          confirmation_status?: string | null
          created_at?: string
          deleted_at?: string | null
          ends_at?: string
          external_reference?: string | null
          flow_checkout_at?: string | null
          flow_with_practitioner_at?: string | null
          id?: string
          note?: string | null
          patient_id?: string
          practitioner_id?: string | null
          practitioner_name?: string | null
          reminder_sent_at?: string | null
          rescheduled?: boolean
          room_id?: string | null
          same_day_info_sent_at?: string | null
          source?: string
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
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
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
      audit_logs: {
        Row: {
          account_id: string
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          summary: string
          team_member_id: string | null
        }
        Insert: {
          account_id: string
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          summary: string
          team_member_id?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          summary?: string
          team_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_actions: {
        Row: {
          account_id: string
          action_type: string
          config: Json
          created_at: string
          id: string
          position: number
          rule_id: string
        }
        Insert: {
          account_id: string
          action_type: string
          config?: Json
          created_at?: string
          id?: string
          position?: number
          rule_id: string
        }
        Update: {
          account_id?: string
          action_type?: string
          config?: Json
          created_at?: string
          id?: string
          position?: number
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_actions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rule_sends: {
        Row: {
          appointment_id: string
          id: string
          rule_id: string
          sent_at: string
        }
        Insert: {
          appointment_id: string
          id?: string
          rule_id: string
          sent_at?: string
        }
        Update: {
          appointment_id?: string
          id?: string
          rule_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rule_sends_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rule_sends_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          filters: Json
          id: string
          is_marketing: boolean
          name: string
          trigger_event: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          filters?: Json
          id?: string
          is_marketing?: boolean
          name?: string
          trigger_event: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          filters?: Json
          id?: string
          is_marketing?: boolean
          name?: string
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_blocks: {
        Row: {
          account_id: string
          clinic_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          note: string | null
          practitioner_id: string | null
          room_id: string | null
          starts_at: string
        }
        Insert: {
          account_id: string
          clinic_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          note?: string | null
          practitioner_id?: string | null
          room_id?: string | null
          starts_at: string
        }
        Update: {
          account_id?: string
          clinic_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          note?: string | null
          practitioner_id?: string | null
          room_id?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_blocks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_practitioner_id_fkey"
            columns: ["practitioner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_room_id_fkey"
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
      care_plans: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          frequency_unit: string
          frequency_value: number
          id: string
          name: string
          patient_id: string
          started_at: string
          total_visits: number
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          frequency_unit?: string
          frequency_value?: number
          id?: string
          name?: string
          patient_id: string
          started_at?: string
          total_visits: number
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          frequency_unit?: string
          frequency_value?: number
          id?: string
          name?: string
          patient_id?: string
          started_at?: string
          total_visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "care_plans_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "care_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          account_id: string
          amount_cents: number
          clinic_id: string | null
          created_at: string
          id: string
          note: string | null
          team_member_id: string
          type: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          clinic_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          team_member_id: string
          type: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          clinic_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          team_member_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_shifts: {
        Row: {
          account_id: string
          closed_at: string | null
          closed_by: string | null
          id: string
          note: string | null
          opened_at: string
          opened_by: string
        }
        Insert: {
          account_id: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by: string
        }
        Update: {
          account_id?: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_shifts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          account_id: string
          address: string | null
          business_hours: Json
          created_at: string
          id: string
          invoice_footer_text: string | null
          legal_name: string | null
          logo_storage_path: string | null
          name: string
          online_booking_enabled: boolean
          slot_duration_minutes: number
          tax_id: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          business_hours?: Json
          created_at?: string
          id?: string
          invoice_footer_text?: string | null
          legal_name?: string | null
          logo_storage_path?: string | null
          name: string
          online_booking_enabled?: boolean
          slot_duration_minutes?: number
          tax_id?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          business_hours?: Json
          created_at?: string
          id?: string
          invoice_footer_text?: string | null
          legal_name?: string | null
          logo_storage_path?: string | null
          name?: string
          online_booking_enabled?: boolean
          slot_duration_minutes?: number
          tax_id?: string | null
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
      contact_log: {
        Row: {
          account_id: string
          action: string
          appointment_id: string | null
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          note: string | null
          patient_id: string
        }
        Insert: {
          account_id: string
          action: string
          appointment_id?: string | null
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          note?: string | null
          patient_id: string
        }
        Update: {
          account_id?: string
          action?: string
          appointment_id?: string | null
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          note?: string | null
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_log_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "contact_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      custom_reports: {
        Row: {
          account_id: string
          config: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          account_id: string
          config: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          fcm_token: string
          id: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fcm_token: string
          id?: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          fcm_token?: string
          id?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      doc_templates: {
        Row: {
          account_id: string
          category: string | null
          created_at: string
          created_by: string | null
          fields: Json
          id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_members"
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
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      membership_payments: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          id: string
          patient_membership_id: string
          period_start: string
          status: string
        }
        Insert: {
          account_id: string
          amount_cents?: number
          created_at?: string
          id?: string
          patient_membership_id: string
          period_start: string
          status?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          patient_membership_id?: string
          period_start?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_payments_patient_membership_id_fkey"
            columns: ["patient_membership_id"]
            isOneToOne: false
            referencedRelation: "patient_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          price_cents: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          price_cents?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      modalities: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "modalities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      online_booking_discount_codes: {
        Row: {
          account_id: string
          active: boolean
          amount_off_cents: number | null
          code: string
          created_at: string
          expires_at: string | null
          id: string
          max_uses: number | null
          percent_off: number | null
          times_used: number
        }
        Insert: {
          account_id: string
          active?: boolean
          amount_off_cents?: number | null
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          percent_off?: number | null
          times_used?: number
        }
        Update: {
          account_id?: string
          active?: boolean
          amount_off_cents?: number | null
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          percent_off?: number | null
          times_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "online_booking_discount_codes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      package_purchase_shares: {
        Row: {
          account_id: string
          created_at: string
          id: string
          package_purchase_id: string
          patient_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          package_purchase_id: string
          patient_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          package_purchase_id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_purchase_shares_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchase_shares_package_purchase_id_fkey"
            columns: ["package_purchase_id"]
            isOneToOne: false
            referencedRelation: "package_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchase_shares_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "package_purchase_shares_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchase_shares_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      package_purchases: {
        Row: {
          account_id: string
          created_by: string | null
          id: string
          invoice_id: string | null
          package_id: string | null
          package_name: string
          patient_id: string
          price_cents: number
          purchased_at: string
          sessions_total: number
          sessions_used: number
        }
        Insert: {
          account_id: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          package_id?: string | null
          package_name: string
          patient_id: string
          price_cents?: number
          purchased_at?: string
          sessions_total: number
          sessions_used?: number
        }
        Update: {
          account_id?: string
          created_by?: string | null
          id?: string
          invoice_id?: string | null
          package_id?: string | null
          package_name?: string
          patient_id?: string
          price_cents?: number
          purchased_at?: string
          sessions_total?: number
          sessions_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchases_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchases_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "package_purchases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_purchases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      packages: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          price_cents: number
          session_count: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          price_cents?: number
          session_count: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          price_cents?: number
          session_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "packages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_app_messages: {
        Row: {
          account_id: string
          body: string
          created_at: string
          direction: string
          id: string
          patient_id: string
        }
        Insert: {
          account_id: string
          body: string
          created_at?: string
          direction: string
          id?: string
          patient_id: string
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          direction?: string
          id?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_app_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_app_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_app_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_app_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patient_contact_numbers: {
        Row: {
          account_id: string
          country_code: string
          created_at: string
          id: string
          is_whatsapp: boolean
          number: string
          patient_id: string
        }
        Insert: {
          account_id: string
          country_code?: string
          created_at?: string
          id?: string
          is_whatsapp?: boolean
          number: string
          patient_id: string
        }
        Update: {
          account_id?: string
          country_code?: string
          created_at?: string
          id?: string
          is_whatsapp?: boolean
          number?: string
          patient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_contact_numbers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_contact_numbers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_contact_numbers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_contact_numbers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patient_docs: {
        Row: {
          account_id: string
          completed_at: string | null
          completed_ip: unknown
          created_at: string
          created_by: string | null
          external_reference: string | null
          fields: Json
          id: string
          patient_id: string
          public_token: string
          template_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_ip?: unknown
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          fields?: Json
          id?: string
          patient_id: string
          public_token?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_ip?: unknown
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          fields?: Json
          id?: string
          patient_id?: string
          public_token?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_docs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_docs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_docs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_docs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_docs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_docs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "doc_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_docs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_files: {
        Row: {
          account_id: string
          created_at: string
          external_reference: string | null
          file_name: string
          file_type: string | null
          id: string
          patient_id: string
          size_bytes: number | null
          storage_path: string | null
          uploaded_by: string | null
          visibility: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_reference?: string | null
          file_name: string
          file_type?: string | null
          id?: string
          patient_id: string
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
          visibility?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_reference?: string | null
          file_name?: string
          file_type?: string | null
          id?: string
          patient_id?: string
          size_bytes?: number | null
          storage_path?: string | null
          uploaded_by?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_files_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_files_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_files_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_files_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_memberships: {
        Row: {
          account_id: string
          created_by: string | null
          id: string
          membership_id: string | null
          membership_name: string
          patient_id: string
          price_cents: number
          started_at: string
          status: string
        }
        Insert: {
          account_id: string
          created_by?: string | null
          id?: string
          membership_id?: string | null
          membership_name: string
          patient_id: string
          price_cents?: number
          started_at?: string
          status?: string
        }
        Update: {
          account_id?: string
          created_by?: string | null
          id?: string
          membership_id?: string | null
          membership_name?: string
          patient_id?: string
          price_cents?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_memberships_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_memberships_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_memberships_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_memberships_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patient_stripe_customers: {
        Row: {
          account_id: string
          created_at: string
          default_payment_method_id: string | null
          id: string
          patient_id: string
          stripe_customer_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          patient_id: string
          stripe_customer_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          default_payment_method_id?: string | null
          id?: string
          patient_id?: string
          stripe_customer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_stripe_customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_stripe_customers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patient_stripe_customers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_stripe_customers_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      patients: {
        Row: {
          account_id: string
          address: string | null
          balance_cents: number
          chief_complaint: string | null
          city: string | null
          clinic_id: string | null
          confirmation_channel: string
          country: string | null
          created_at: string
          date_of_birth: string | null
          default_practitioner_id: string | null
          diagnosis: string | null
          do_not_contact: boolean
          email: string | null
          emergency_contact: string | null
          external_reference: string | null
          first_name: string
          gender: string | null
          goals: string | null
          has_phone: boolean
          id: string
          invoice_email_enabled: boolean
          is_minor: boolean
          last_name: string | null
          marketing_channels: string[]
          national_id: string | null
          notes: string | null
          occupation: string | null
          photo_storage_path: string | null
          postal_code: string | null
          preferred_language: string
          recall_priority: boolean
          recall_status: string
          red_flags: string | null
          referral_source: string | null
          referred_by_patient_id: string | null
          reminder_channel: string
          search_name: string | null
          status: string
          sticky_note: string | null
          tags: string[]
          tutor_patient_id: string | null
          user_id: string | null
          yellow_flags: string | null
        }
        Insert: {
          account_id: string
          address?: string | null
          balance_cents?: number
          chief_complaint?: string | null
          city?: string | null
          clinic_id?: string | null
          confirmation_channel?: string
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_practitioner_id?: string | null
          diagnosis?: string | null
          do_not_contact?: boolean
          email?: string | null
          emergency_contact?: string | null
          external_reference?: string | null
          first_name: string
          gender?: string | null
          goals?: string | null
          has_phone?: boolean
          id?: string
          invoice_email_enabled?: boolean
          is_minor?: boolean
          last_name?: string | null
          marketing_channels?: string[]
          national_id?: string | null
          notes?: string | null
          occupation?: string | null
          photo_storage_path?: string | null
          postal_code?: string | null
          preferred_language?: string
          recall_priority?: boolean
          recall_status?: string
          red_flags?: string | null
          referral_source?: string | null
          referred_by_patient_id?: string | null
          reminder_channel?: string
          search_name?: string | null
          status?: string
          sticky_note?: string | null
          tags?: string[]
          tutor_patient_id?: string | null
          user_id?: string | null
          yellow_flags?: string | null
        }
        Update: {
          account_id?: string
          address?: string | null
          balance_cents?: number
          chief_complaint?: string | null
          city?: string | null
          clinic_id?: string | null
          confirmation_channel?: string
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          default_practitioner_id?: string | null
          diagnosis?: string | null
          do_not_contact?: boolean
          email?: string | null
          emergency_contact?: string | null
          external_reference?: string | null
          first_name?: string
          gender?: string | null
          goals?: string | null
          has_phone?: boolean
          id?: string
          invoice_email_enabled?: boolean
          is_minor?: boolean
          last_name?: string | null
          marketing_channels?: string[]
          national_id?: string | null
          notes?: string | null
          occupation?: string | null
          photo_storage_path?: string | null
          postal_code?: string | null
          preferred_language?: string
          recall_priority?: boolean
          recall_status?: string
          red_flags?: string | null
          referral_source?: string | null
          referred_by_patient_id?: string | null
          reminder_channel?: string
          search_name?: string | null
          status?: string
          sticky_note?: string | null
          tags?: string[]
          tutor_patient_id?: string | null
          user_id?: string | null
          yellow_flags?: string | null
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
          {
            foreignKeyName: "patients_default_practitioner_id_fkey"
            columns: ["default_practitioner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_referred_by_patient_id_fkey"
            columns: ["referred_by_patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patients_referred_by_patient_id_fkey"
            columns: ["referred_by_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_referred_by_patient_id_fkey"
            columns: ["referred_by_patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patients_tutor_patient_id_fkey"
            columns: ["tutor_patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "patients_tutor_patient_id_fkey"
            columns: ["tutor_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patients_tutor_patient_id_fkey"
            columns: ["tutor_patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schedules: {
        Row: {
          account_id: string
          created_at: string
          id: string
          installments_paid: number
          installments_total: number | null
          interval: string
          interval_count: number
          package_purchase_id: string | null
          patient_id: string
          patient_membership_id: string | null
          status: string
          stripe_subscription_id: string | null
          stripe_subscription_schedule_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          installments_paid?: number
          installments_total?: number | null
          interval?: string
          interval_count?: number
          package_purchase_id?: string | null
          patient_id: string
          patient_membership_id?: string | null
          status?: string
          stripe_subscription_id?: string | null
          stripe_subscription_schedule_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          installments_paid?: number
          installments_total?: number | null
          interval?: string
          interval_count?: number
          package_purchase_id?: string | null
          patient_id?: string
          patient_membership_id?: string | null
          status?: string
          stripe_subscription_id?: string | null
          stripe_subscription_schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_schedules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_schedules_package_purchase_id_fkey"
            columns: ["package_purchase_id"]
            isOneToOne: false
            referencedRelation: "package_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "payment_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_schedules_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "payment_schedules_patient_membership_id_fkey"
            columns: ["patient_membership_id"]
            isOneToOne: false
            referencedRelation: "patient_memberships"
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
          stripe_payment_intent_id: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          id?: string
          invoice_id: string
          method?: string
          paid_at?: string
          stripe_payment_intent_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          id?: string
          invoice_id?: string
          method?: string
          paid_at?: string
          stripe_payment_intent_id?: string | null
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
      photo_upload_tokens: {
        Row: {
          account_id: string
          created_at: string
          patient_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          patient_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          patient_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "photo_upload_tokens_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_upload_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "photo_upload_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_upload_tokens_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      referral_sources: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
          status: string
          visibility: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
          status?: string
          visibility?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_sources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      reschedule_reasons: {
        Row: {
          account_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "reschedule_reasons_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_replies: {
        Row: {
          account_id: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_replies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_replies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_replies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_members"
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
      stripe_payment_events: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string
          id: string
          payment_schedule_id: string
          period_start: string
          status: string
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string
          id?: string
          payment_schedule_id: string
          period_start: string
          status: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          payment_schedule_id?: string
          period_start?: string
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_payment_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_payment_events_payment_schedule_id_fkey"
            columns: ["payment_schedule_id"]
            isOneToOne: false
            referencedRelation: "payment_schedules"
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
          business_hours: Json | null
          color: string
          created_at: string
          dashboard_layout: Json
          deleted_at: string | null
          full_name: string
          id: string
          is_owner: boolean
          online_booking_enabled: boolean
          role: string
          role_id: string | null
          theme_preference: string
          user_id: string
        }
        Insert: {
          account_id: string
          business_hours?: Json | null
          color?: string
          created_at?: string
          dashboard_layout?: Json
          deleted_at?: string | null
          full_name: string
          id?: string
          is_owner?: boolean
          online_booking_enabled?: boolean
          role?: string
          role_id?: string | null
          theme_preference?: string
          user_id: string
        }
        Update: {
          account_id?: string
          business_hours?: Json | null
          color?: string
          created_at?: string
          dashboard_layout?: Json
          deleted_at?: string | null
          full_name?: string
          id?: string
          is_owner?: boolean
          online_booking_enabled?: boolean
          role?: string
          role_id?: string | null
          theme_preference?: string
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
          {
            foreignKeyName: "team_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "account_roles"
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
      webhook_deliveries: {
        Row: {
          account_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          request_id: number | null
          webhook_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          event_type: string
          id?: string
          payload: Json
          request_id?: number | null
          webhook_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          request_id?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          events: string[]
          id: string
          secret: string
          url: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          events?: string[]
          id?: string
          secret?: string
          url: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          events?: string[]
          id?: string
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_reads: {
        Row: {
          account_id: string
          conversation_key: string
          last_read_at: string
        }
        Insert: {
          account_id: string
          conversation_key: string
          last_read_at?: string
        }
        Update: {
          account_id?: string
          conversation_key?: string
          last_read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_reads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          account_id: string
          appointment_id: string | null
          body_preview: string | null
          channel: string
          created_at: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          media_filename: string | null
          media_mime_type: string | null
          media_storage_path: string | null
          media_type: string | null
          patient_id: string | null
          phone_number: string | null
          purpose: string | null
          status: string
          template_name: string | null
          updated_at: string
          wamid: string | null
        }
        Insert: {
          account_id: string
          appointment_id?: string | null
          body_preview?: string | null
          channel?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_filename?: string | null
          media_mime_type?: string | null
          media_storage_path?: string | null
          media_type?: string | null
          patient_id?: string | null
          phone_number?: string | null
          purpose?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wamid?: string | null
        }
        Update: {
          account_id?: string
          appointment_id?: string | null
          body_preview?: string | null
          channel?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          media_filename?: string | null
          media_mime_type?: string | null
          media_storage_path?: string | null
          media_type?: string | null
          patient_id?: string | null
          phone_number?: string | null
          purpose?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wamid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patient_live_balances"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "recall_candidates"
            referencedColumns: ["patient_id"]
          },
        ]
      }
    }
    Views: {
      patient_live_balances: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          patient_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      recall_candidates: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          days_since_last_appointment: number | null
          default_practitioner_id: string | null
          email: string | null
          first_name: string | null
          last_appointment_at: string | null
          last_name: string | null
          patient_id: string | null
          preferred_language: string | null
          recall_priority: boolean | null
          tags: string[] | null
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
            foreignKeyName: "patients_default_practitioner_id_fkey"
            columns: ["default_practitioner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invite: {
        Args: { p_token: string }
        Returns: {
          account_id: string
        }[]
      }
      can_access_patient: {
        Args: { target_account_id: string; target_patient_id: string }
        Returns: boolean
      }
      claim_patient_profile: {
        Args: { p_account_slug?: string }
        Returns: {
          patient_id: string
        }[]
      }
      create_account_with_owner:
        | {
            Args: { p_account_name: string; p_clinic_name: string }
            Returns: {
              account_id: string
              clinic_id: string
            }[]
          }
        | {
            Args: {
              p_account_name: string
              p_clinic_name: string
              p_owner_name?: string
            }
            Returns: {
              account_id: string
              clinic_id: string
            }[]
          }
      create_patient_booking: {
        Args: {
          p_appointment_type_id: string
          p_clinic_id: string
          p_note: string
          p_starts_at: string
          p_team_member_id: string
        }
        Returns: Json
      }
      create_public_booking: {
        Args: {
          p_account_slug: string
          p_appointment_type_id: string
          p_clinic_id: string
          p_country_code?: string
          p_discount_code?: string
          p_email: string
          p_first_name: string
          p_last_name: string
          p_note: string
          p_phone: string
          p_starts_at: string
          p_team_member_id: string
        }
        Returns: Json
      }
      current_team_member_id: {
        Args: { target_account_id: string }
        Returns: string
      }
      generate_unique_account_slug: {
        Args: { base_name: string }
        Returns: string
      }
      get_booking_blocked_times: {
        Args: { p_clinic_id: string; p_from: string; p_to: string }
        Returns: {
          ends_at: string
          practitioner_id: string
          starts_at: string
        }[]
      }
      get_booking_busy_times: {
        Args: {
          p_clinic_id: string
          p_from: string
          p_team_member_id: string
          p_to: string
        }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      get_my_permissions: { Args: { target_account_id: string }; Returns: Json }
      get_patient_booking_info: { Args: never; Returns: Json }
      get_public_booking_info: { Args: { p_slug: string }; Returns: Json }
      get_public_patient_doc: { Args: { p_token: string }; Returns: Json }
      has_permission: {
        Args: { perm_key: string; target_account_id: string }
        Returns: boolean
      }
      has_restriction: {
        Args: { perm_key: string; target_account_id: string }
        Returns: boolean
      }
      is_account_member: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      is_own_patient_account: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      permission_scope: {
        Args: { perm_key: string; target_account_id: string }
        Returns: string
      }
      record_app_open: {
        Args: {
          p_account_slug: string
          p_device_id: string
          p_platform: string
        }
        Returns: undefined
      }
      save_public_patient_doc: {
        Args: { p_complete?: boolean; p_fields: Json; p_token: string }
        Returns: undefined
      }
      seed_account_roles: {
        Args: { target_account_id: string }
        Returns: string
      }
      slugify: { Args: { input: string }; Returns: string }
      unaccent_lower: { Args: { input: string }; Returns: string }
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
