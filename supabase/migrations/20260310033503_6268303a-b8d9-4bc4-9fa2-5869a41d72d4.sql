
-- =====================================================
-- 1. BALANCED JOURNAL ENTRY VALIDATION TRIGGER
-- Prevents posting journal entries where debits ≠ credits
-- =====================================================

CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
  v_entry_id uuid;
  v_status text;
BEGIN
  -- Determine which journal_entry_id to check
  IF TG_OP = 'DELETE' THEN
    v_entry_id := OLD.journal_entry_id;
  ELSE
    v_entry_id := NEW.journal_entry_id;
  END IF;

  -- Get the parent entry status
  SELECT status INTO v_status FROM public.journal_entries WHERE id = v_entry_id;

  -- Only validate if the entry is posted
  IF v_status = 'posted' THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_total_debit, v_total_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_entry_id;

    -- Account for current row in trigger
    IF TG_OP = 'INSERT' THEN
      v_total_debit := v_total_debit + NEW.debit;
      v_total_credit := v_total_credit + NEW.credit;
    END IF;

    IF ABS(v_total_debit - v_total_credit) > 0.005 THEN
      RAISE EXCEPTION 'Journal entry is unbalanced: debits (%) ≠ credits (%)', 
        ROUND(v_total_debit, 2), ROUND(v_total_credit, 2);
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Validate balance on status change to 'posted'
CREATE OR REPLACE FUNCTION public.validate_je_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_debit numeric;
  v_total_credit numeric;
BEGIN
  IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_total_debit, v_total_credit
    FROM public.journal_entry_lines
    WHERE journal_entry_id = NEW.id;

    IF ABS(v_total_debit - v_total_credit) > 0.005 THEN
      RAISE EXCEPTION 'Cannot post unbalanced journal entry: debits (%) ≠ credits (%)',
        ROUND(v_total_debit, 2), ROUND(v_total_credit, 2);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_je_balance
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_je_status_change();

-- =====================================================
-- 2. PERIOD CLOSE / LOCK MECHANISM
-- =====================================================

CREATE TABLE public.closed_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid REFERENCES auth.users(id),
  notes text NOT NULL DEFAULT '',
  UNIQUE(period_start, period_end)
);

ALTER TABLE public.closed_periods ENABLE ROW LEVEL SECURITY;

-- Only admins can manage closed periods
CREATE POLICY "Admins can manage closed periods"
  ON public.closed_periods FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- All authenticated users can read closed periods
CREATE POLICY "Authenticated can read closed periods"
  ON public.closed_periods FOR SELECT TO authenticated
  USING (true);

-- Function to check if a date falls in a closed period
CREATE OR REPLACE FUNCTION public.is_period_closed(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.closed_periods
    WHERE p_date >= period_start AND p_date <= period_end
  )
$$;

-- Prevent inserts/updates into closed periods on transactions
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_date date;
BEGIN
  -- Get the date field from the row
  v_date := NEW.date;

  IF v_date IS NOT NULL AND public.is_period_closed(v_date) THEN
    RAISE EXCEPTION 'Cannot modify records in a closed period (date: %)', v_date;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply period lock triggers to all date-bearing tables
CREATE TRIGGER trg_period_lock_transactions
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

CREATE TRIGGER trg_period_lock_journal_entries
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

CREATE TRIGGER trg_period_lock_job_invoices
  BEFORE INSERT OR UPDATE ON public.job_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

CREATE TRIGGER trg_period_lock_vendor_invoices
  BEFORE INSERT OR UPDATE ON public.vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

CREATE TRIGGER trg_period_lock_payroll_runs
  BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();

-- Payroll runs use period_start as the date field
CREATE OR REPLACE FUNCTION public.enforce_period_lock_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_period_closed(NEW.period_start) OR public.is_period_closed(NEW.period_end) THEN
    RAISE EXCEPTION 'Cannot modify payroll in a closed period (% — %)', NEW.period_start, NEW.period_end;
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the generic one on payroll_runs with the payroll-specific one
DROP TRIGGER IF EXISTS trg_period_lock_payroll_runs ON public.payroll_runs;
CREATE TRIGGER trg_period_lock_payroll_runs
  BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- =====================================================
-- 3. AUDIT TRAIL TABLE
-- Immutable log of all changes to core tables
-- =====================================================

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id text NOT NULL,
  action text NOT NULL, -- INSERT, UPDATE, DELETE
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs; no one can modify
CREATE POLICY "Admins can read audit logs"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach audit triggers to all core tables
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_timesheets AFTER INSERT OR UPDATE OR DELETE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
