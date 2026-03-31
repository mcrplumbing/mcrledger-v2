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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          assigned_to: string
          category: string
          cost: number
          created_at: string
          current_value: number
          depreciation_method: string
          id: string
          job_id: string | null
          name: string
          purchase_date: string | null
        }
        Insert: {
          assigned_to?: string
          category?: string
          cost?: number
          created_at?: string
          current_value?: number
          depreciation_method?: string
          id?: string
          job_id?: string | null
          name: string
          purchase_date?: string | null
        }
        Update: {
          assigned_to?: string
          category?: string
          cost?: number
          created_at?: string
          current_value?: number
          depreciation_method?: string
          id?: string
          job_id?: string | null
          name?: string
          purchase_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      backup_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          started_at: string
          status: string
          storage_path: string
          tables_backed_up: number
          total_records: number
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: string
          storage_path?: string
          tables_backed_up?: number
          total_records?: number
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          started_at?: string
          status?: string
          storage_path?: string
          tables_backed_up?: number
          total_records?: number
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_number: string
          account_type: string
          active: boolean
          bank_name: string
          created_at: string
          id: string
          name: string
          next_check_number: number
          opening_balance: number
          routing_number: string
        }
        Insert: {
          account_number?: string
          account_type?: string
          active?: boolean
          bank_name?: string
          created_at?: string
          id?: string
          name: string
          next_check_number?: number
          opening_balance?: number
          routing_number?: string
        }
        Update: {
          account_number?: string
          account_type?: string
          active?: boolean
          bank_name?: string
          created_at?: string
          id?: string
          name?: string
          next_check_number?: number
          opening_balance?: number
          routing_number?: string
        }
        Relationships: []
      }
      bank_reconciliations: {
        Row: {
          bank_account_id: string | null
          cleared_balance: number
          completed_at: string | null
          created_at: string
          difference: number
          id: string
          notes: string
          statement_balance: number
          statement_date: string
          status: string
        }
        Insert: {
          bank_account_id?: string | null
          cleared_balance?: number
          completed_at?: string | null
          created_at?: string
          difference?: number
          id?: string
          notes?: string
          statement_balance?: number
          statement_date: string
          status?: string
        }
        Update: {
          bank_account_id?: string | null
          cleared_balance?: number
          completed_at?: string | null
          created_at?: string
          difference?: number
          id?: string
          notes?: string
          statement_balance?: number
          statement_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      closed_periods: {
        Row: {
          closed_at: string
          closed_by: string | null
          id: string
          notes: string
          period_end: string
          period_start: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          id?: string
          notes?: string
          period_end: string
          period_start: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          id?: string
          notes?: string
          period_end?: string
          period_start?: string
        }
        Relationships: []
      }
      employee_deductions: {
        Row: {
          active: boolean
          amount: number
          calc_method: string
          created_at: string
          deduction_type: string
          description: string
          employee_id: string
          id: string
          max_annual: number | null
          percentage: number
          pre_tax: boolean
          priority: number
          reduces_fica: boolean
        }
        Insert: {
          active?: boolean
          amount?: number
          calc_method?: string
          created_at?: string
          deduction_type?: string
          description?: string
          employee_id: string
          id?: string
          max_annual?: number | null
          percentage?: number
          pre_tax?: boolean
          priority?: number
          reduces_fica?: boolean
        }
        Update: {
          active?: boolean
          amount?: number
          calc_method?: string
          created_at?: string
          deduction_type?: string
          description?: string
          employee_id?: string
          id?: string
          max_annual?: number | null
          percentage?: number
          pre_tax?: boolean
          priority?: number
          reduces_fica?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "employee_deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_pto: {
        Row: {
          accrual_rate: number
          balance: number
          created_at: string
          employee_id: string
          id: string
          pto_type: string
          updated_at: string
        }
        Insert: {
          accrual_rate?: number
          balance?: number
          created_at?: string
          employee_id: string
          id?: string
          pto_type?: string
          updated_at?: string
        }
        Update: {
          accrual_rate?: number
          balance?: number
          created_at?: string
          employee_id?: string
          id?: string
          pto_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_pto_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          address: string
          created_at: string
          email: string
          employee_number: string
          filing_status: string
          id: string
          name: string
          pay_period: string
          pay_type: string
          rate: number
          role: string
          ssn: string
          state: string
          withholding_allowances: number
        }
        Insert: {
          active?: boolean
          address?: string
          created_at?: string
          email?: string
          employee_number: string
          filing_status?: string
          id?: string
          name: string
          pay_period?: string
          pay_type?: string
          rate?: number
          role?: string
          ssn?: string
          state?: string
          withholding_allowances?: number
        }
        Update: {
          active?: boolean
          address?: string
          created_at?: string
          email?: string
          employee_number?: string
          filing_status?: string
          id?: string
          name?: string
          pay_period?: string
          pay_type?: string
          rate?: number
          role?: string
          ssn?: string
          state?: string
          withholding_allowances?: number
        }
        Relationships: []
      }
      gl_accounts: {
        Row: {
          account_number: string
          account_type: string
          active: boolean
          created_at: string
          id: string
          name: string
          normal_balance: string
          parent_id: string | null
        }
        Insert: {
          account_number: string
          account_type?: string
          active?: boolean
          created_at?: string
          id?: string
          name: string
          normal_balance?: string
          parent_id?: string | null
        }
        Update: {
          account_number?: string
          account_type?: string
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          normal_balance?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_invoices: {
        Row: {
          amount: number
          client: string
          created_at: string
          date: string
          description: string
          due_date: string | null
          id: string
          invoice_number: string
          job_id: string | null
          paid: number
          status: string
          version: number
        }
        Insert: {
          amount?: number
          client?: string
          created_at?: string
          date?: string
          description?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          job_id?: string | null
          paid?: number
          status?: string
          version?: number
        }
        Update: {
          amount?: number
          client?: string
          created_at?: string
          date?: string
          description?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          job_id?: string | null
          paid?: number
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          budget: number
          client: string
          created_at: string
          id: string
          job_number: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          budget?: number
          client?: string
          created_at?: string
          id?: string
          job_number: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          budget?: number
          client?: string
          created_at?: string
          id?: string
          job_number?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          created_at: string
          date: string
          description: string
          entry_number: string
          id: string
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          date?: string
          description?: string
          entry_number?: string
          id?: string
          status?: string
          version?: number
        }
        Update: {
          created_at?: string
          date?: string
          description?: string
          entry_number?: string
          id?: string
          status?: string
          version?: number
        }
        Relationships: []
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          description: string
          id: string
          job_id: string | null
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string
          id?: string
          job_id?: string | null
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string
          id?: string
          job_id?: string | null
          journal_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          balance: number
          created_at: string
          id: string
          name: string
          next_due: string | null
          payment: number
          principal: number
          rate: number
          type: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          name: string
          next_due?: string | null
          payment?: number
          principal?: number
          rate?: number
          type?: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          name?: string
          next_due?: string | null
          payment?: number
          principal?: number
          rate?: number
          type?: string
        }
        Relationships: []
      }
      payroll_entries: {
        Row: {
          created_at: string
          deductions_posttax: number
          deductions_pretax: number
          employee_id: string
          fed_tax: number
          fica: number
          gross_pay: number
          hours_worked: number
          id: string
          medicare_tax: number
          net_pay: number
          payroll_run_id: string
          sdi_tax: number
          ss_tax: number
          state_tax: number
        }
        Insert: {
          created_at?: string
          deductions_posttax?: number
          deductions_pretax?: number
          employee_id: string
          fed_tax?: number
          fica?: number
          gross_pay?: number
          hours_worked?: number
          id?: string
          medicare_tax?: number
          net_pay?: number
          payroll_run_id: string
          sdi_tax?: number
          ss_tax?: number
          state_tax?: number
        }
        Update: {
          created_at?: string
          deductions_posttax?: number
          deductions_pretax?: number
          employee_id?: string
          fed_tax?: number
          fica?: number
          gross_pay?: number
          hours_worked?: number
          id?: string
          medicare_tax?: number
          net_pay?: number
          payroll_run_id?: string
          sdi_tax?: number
          ss_tax?: number
          state_tax?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          id: string
          period_end: string
          period_start: string
          run_date: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          run_date?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          run_date?: string
          status?: string
        }
        Relationships: []
      }
      pto_ledger: {
        Row: {
          created_at: string
          employee_id: string
          hours: number
          id: string
          payroll_run_id: string | null
          pto_type: string
          reason: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          hours?: number
          id?: string
          payroll_run_id?: string | null
          pto_type?: string
          reason?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          hours?: number
          id?: string
          payroll_run_id?: string | null
          pto_type?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "pto_ledger_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pto_ledger_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      received_payments: {
        Row: {
          amount: number
          client: string
          created_at: string
          deposit_transaction_id: string | null
          deposited: boolean
          id: string
          invoice_id: string | null
          memo: string
          payment_date: string
          payment_method: string
          reference_no: string
        }
        Insert: {
          amount?: number
          client?: string
          created_at?: string
          deposit_transaction_id?: string | null
          deposited?: boolean
          id?: string
          invoice_id?: string | null
          memo?: string
          payment_date?: string
          payment_method?: string
          reference_no?: string
        }
        Update: {
          amount?: number
          client?: string
          created_at?: string
          deposit_transaction_id?: string | null
          deposited?: boolean
          id?: string
          invoice_id?: string | null
          memo?: string
          payment_date?: string
          payment_method?: string
          reference_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "received_payments_deposit_transaction_id_fkey"
            columns: ["deposit_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "received_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "job_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_parse_jobs: {
        Row: {
          created_at: string
          effective_year: number
          error: string | null
          id: string
          input_text: string
          result: Json | null
          state_name: string | null
          status: string
          tax_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          effective_year?: number
          error?: string | null
          id?: string
          input_text: string
          result?: Json | null
          state_name?: string | null
          status?: string
          tax_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          effective_year?: number
          error?: string | null
          id?: string
          input_text?: string
          result?: Json | null
          state_name?: string | null
          status?: string
          tax_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_settings: {
        Row: {
          allowances: number
          bracket_max: number | null
          bracket_min: number
          created_at: string
          description: string
          effective_year: number
          filing_status: string
          id: string
          method: string
          pay_period: string
          rate: number
          tax_type: string
          withholding_amount: number
        }
        Insert: {
          allowances?: number
          bracket_max?: number | null
          bracket_min?: number
          created_at?: string
          description?: string
          effective_year?: number
          filing_status?: string
          id?: string
          method?: string
          pay_period?: string
          rate?: number
          tax_type: string
          withholding_amount?: number
        }
        Update: {
          allowances?: number
          bracket_max?: number | null
          bracket_min?: number
          created_at?: string
          description?: string
          effective_year?: number
          filing_status?: string
          id?: string
          method?: string
          pay_period?: string
          rate?: number
          tax_type?: string
          withholding_amount?: number
        }
        Relationships: []
      }
      timesheets: {
        Row: {
          created_at: string
          date: string
          description: string
          employee_id: string
          hours: number
          id: string
          job_id: string
          pay_class: string
        }
        Insert: {
          created_at?: string
          date?: string
          description?: string
          employee_id: string
          hours?: number
          id?: string
          job_id: string
          pay_class?: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string
          employee_id?: string
          hours?: number
          id?: string
          job_id?: string
          pay_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          balance: number
          bank_account_id: string | null
          category: string
          check_no: string
          created_at: string
          date: string
          deposit: number
          gl_account_id: string | null
          id: string
          job_id: string | null
          memo: string
          payee: string
          payment: number
          reconciled: boolean
          vendor_invoice_id: string | null
          version: number
        }
        Insert: {
          balance?: number
          bank_account_id?: string | null
          category?: string
          check_no?: string
          created_at?: string
          date?: string
          deposit?: number
          gl_account_id?: string | null
          id?: string
          job_id?: string | null
          memo?: string
          payee?: string
          payment?: number
          reconciled?: boolean
          vendor_invoice_id?: string | null
          version?: number
        }
        Update: {
          balance?: number
          bank_account_id?: string | null
          category?: string
          check_no?: string
          created_at?: string
          date?: string
          deposit?: number
          gl_account_id?: string | null
          id?: string
          job_id?: string | null
          memo?: string
          payee?: string
          payment?: number
          reconciled?: boolean
          vendor_invoice_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_vendor_invoice_id_fkey"
            columns: ["vendor_invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      user_page_permissions: {
        Row: {
          created_at: string
          id: string
          page_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          page_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          page_key?: string
          user_id?: string
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
          role?: Database["public"]["Enums"]["app_role"]
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
      vendor_invoices: {
        Row: {
          amount: number
          created_at: string
          date: string
          due_date: string | null
          id: string
          invoice_no: string
          job_id: string | null
          paid: number
          status: string
          vendor_id: string
          version: number
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          due_date?: string | null
          id?: string
          invoice_no?: string
          job_id?: string | null
          paid?: number
          status?: string
          vendor_id: string
          version?: number
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          due_date?: string | null
          id?: string
          invoice_no?: string
          job_id?: string | null
          paid?: number
          status?: string
          vendor_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string
          contact: string
          created_at: string
          email: string
          id: string
          is_1099: boolean
          name: string
          phone: string
          tax_id: string
        }
        Insert: {
          address?: string
          contact?: string
          created_at?: string
          email?: string
          id?: string
          is_1099?: boolean
          name: string
          phone?: string
          tax_id?: string
        }
        Update: {
          address?: string
          contact?: string
          created_at?: string
          email?: string
          id?: string
          is_1099?: boolean
          name?: string
          phone?: string
          tax_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      find_gl_account: { Args: { p_pattern: string }; Returns: string }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_period_closed: { Args: { p_date: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user" | "viewer"
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
      app_role: ["admin", "user", "viewer"],
    },
  },
} as const
