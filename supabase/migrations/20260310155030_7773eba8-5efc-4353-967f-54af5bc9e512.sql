
-- ========================================================
-- 1. ATTACH ALL TRIGGERS TO TABLES
-- ========================================================

-- Drop existing triggers first to avoid conflicts
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public') LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.trigger_name, r.event_object_table);
  END LOOP;
END $$;

-- ============ AUDIT TRIGGERS (INSERT/UPDATE/DELETE) ============
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ============ AUTO-POST TRIGGERS ============
CREATE TRIGGER auto_post_transaction AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE TRIGGER auto_post_job_invoice AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE TRIGGER auto_post_vendor_invoice AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE TRIGGER auto_post_payroll_run AFTER INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
CREATE TRIGGER auto_post_received_payment AFTER INSERT ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.auto_post_received_payment();

-- ============ PERIOD LOCK TRIGGERS ============
CREATE TRIGGER period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_timesheets BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_payroll_runs BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- ============ VERSION INCREMENT TRIGGERS ============
CREATE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- ============ JOURNAL ENTRY VALIDATION TRIGGERS ============
CREATE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();
CREATE TRIGGER validate_je_lines BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();

-- ========================================================
-- 2. UPDATE auto_post_job_invoice TO HANDLE UPDATES (void old JE + create new)
-- ========================================================
CREATE OR REPLACE FUNCTION public.auto_post_job_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ar_id uuid;
  v_revenue_id uuid;
  v_je_id uuid;
BEGIN
  -- On UPDATE, void the old journal entry first
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.journal_entries 
    SET status = 'void', description = 'VOIDED (amended): ' || description
    WHERE entry_number = 'INV-' || OLD.invoice_number
      AND status = 'posted';
  END IF;

  IF NEW.amount <= 0 THEN RETURN NEW; END IF;

  v_ar_id := public.find_gl_account('1100');
  IF v_ar_id IS NULL THEN
    v_ar_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'asset' AND active = true AND name ILIKE '%receivable%' ORDER BY account_number LIMIT 1);
  END IF;

  v_revenue_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'revenue' AND active = true ORDER BY account_number LIMIT 1);

  IF v_ar_id IS NULL OR v_revenue_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES ('INV-' || NEW.invoice_number, NEW.date, 'Invoice ' || NEW.invoice_number || ' - ' || NEW.client, 'posted')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
  VALUES
    (v_je_id, v_ar_id, NEW.amount, 0, 'Invoice ' || NEW.invoice_number, NEW.job_id),
    (v_je_id, v_revenue_id, 0, NEW.amount, 'Invoice ' || NEW.invoice_number, NEW.job_id);

  RETURN NEW;
END;
$function$;

-- ========================================================
-- 3. UPDATE auto_post_vendor_invoice TO HANDLE UPDATES
-- ========================================================
CREATE OR REPLACE FUNCTION public.auto_post_vendor_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ap_id uuid;
  v_expense_id uuid;
  v_je_id uuid;
BEGIN
  -- On UPDATE, void the old journal entry first
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.journal_entries 
    SET status = 'void', description = 'VOIDED (amended): ' || description
    WHERE entry_number = 'VI-' || OLD.invoice_no
      AND status = 'posted';
  END IF;

  IF NEW.amount <= 0 THEN RETURN NEW; END IF;

  v_ap_id := public.find_gl_account('2000');
  IF v_ap_id IS NULL THEN
    v_ap_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'liability' AND active = true ORDER BY account_number LIMIT 1);
  END IF;

  v_expense_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'expense' AND active = true ORDER BY account_number LIMIT 1);

  IF v_ap_id IS NULL OR v_expense_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES ('VI-' || NEW.invoice_no, NEW.date, 'Vendor invoice ' || NEW.invoice_no, 'posted')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
  VALUES
    (v_je_id, v_expense_id, NEW.amount, 0, 'Vendor invoice ' || NEW.invoice_no, NEW.job_id),
    (v_je_id, v_ap_id, 0, NEW.amount, 'Vendor invoice ' || NEW.invoice_no, NEW.job_id);

  RETURN NEW;
END;
$function$;

-- Now add UPDATE triggers for invoices (replacing INSERT-only)
DROP TRIGGER IF EXISTS auto_post_job_invoice ON public.job_invoices;
DROP TRIGGER IF EXISTS auto_post_vendor_invoice ON public.vendor_invoices;
CREATE TRIGGER auto_post_job_invoice AFTER INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE TRIGGER auto_post_vendor_invoice AFTER INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
