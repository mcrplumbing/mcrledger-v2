
-- ============================================================
-- 1. RE-ATTACH ALL DATABASE TRIGGERS (they keep disappearing)
-- ============================================================

-- Audit triggers on all core tables
CREATE OR REPLACE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_employee_deductions AFTER INSERT OR UPDATE OR DELETE ON public.employee_deductions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- Period lock triggers
CREATE OR REPLACE TRIGGER period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_timesheets BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_payroll_runs BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- Version increment triggers
CREATE OR REPLACE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- JE balance validation triggers
CREATE OR REPLACE TRIGGER validate_je_balance BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
CREATE OR REPLACE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();

-- Auto-post triggers (INSERT only for new records)
CREATE OR REPLACE TRIGGER auto_post_txn AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE OR REPLACE TRIGGER auto_post_vi AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE OR REPLACE TRIGGER auto_post_ji AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE OR REPLACE TRIGGER auto_post_payroll AFTER INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();

-- ============================================================
-- 2. ADD bank_account_id TO bank_reconciliations
-- ============================================================
ALTER TABLE public.bank_reconciliations ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.bank_accounts(id);

-- ============================================================
-- 3. ADD gl_account_id TO transactions for explicit GL mapping
-- ============================================================
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS gl_account_id uuid REFERENCES public.gl_accounts(id);

-- ============================================================
-- 4. UPDATE auto_post_transaction to use gl_account_id when set
--    and handle UPDATE operations (reverse old JE, create new)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_post_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cash_id uuid;
  v_offset_id uuid;
  v_je_id uuid;
  v_amount numeric;
  v_is_payment boolean;
  v_entry_num text;
BEGIN
  -- On UPDATE, find and void the old journal entry
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.journal_entries 
    SET status = 'void', description = 'VOIDED (amended): ' || description
    WHERE entry_number = 'CHK-' || COALESCE(NULLIF(OLD.check_no, ''), LEFT(OLD.id::text, 8))
      AND status = 'posted';
  END IF;

  -- Find cash account
  v_cash_id := public.find_gl_account('1000');
  IF v_cash_id IS NULL THEN
    v_cash_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'asset' AND active = true ORDER BY account_number LIMIT 1);
  END IF;
  IF v_cash_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.payment > 0 THEN
    v_is_payment := true;
    v_amount := NEW.payment;
    -- Use explicit GL account if set, otherwise default
    v_offset_id := COALESCE(
      NEW.gl_account_id,
      (SELECT id FROM public.gl_accounts WHERE account_type = 'expense' AND active = true ORDER BY account_number LIMIT 1)
    );
  ELSIF NEW.deposit > 0 THEN
    v_is_payment := false;
    v_amount := NEW.deposit;
    v_offset_id := COALESCE(
      NEW.gl_account_id,
      (SELECT id FROM public.gl_accounts WHERE account_type = 'revenue' AND active = true ORDER BY account_number LIMIT 1)
    );
  ELSE
    RETURN NEW;
  END IF;

  IF v_offset_id IS NULL OR v_amount <= 0 THEN RETURN NEW; END IF;

  v_entry_num := 'CHK-' || COALESCE(NULLIF(NEW.check_no, ''), LEFT(NEW.id::text, 8));

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES (v_entry_num, NEW.date, COALESCE(NULLIF(NEW.memo, ''), NEW.payee), 'posted')
  RETURNING id INTO v_je_id;

  IF v_is_payment THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
    VALUES
      (v_je_id, v_offset_id, v_amount, 0, COALESCE(NULLIF(NEW.memo, ''), NEW.payee), NEW.job_id),
      (v_je_id, v_cash_id, 0, v_amount, COALESCE(NULLIF(NEW.memo, ''), NEW.payee), NEW.job_id);
  ELSE
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
    VALUES
      (v_je_id, v_cash_id, v_amount, 0, COALESCE(NULLIF(NEW.memo, ''), NEW.payee), NEW.job_id),
      (v_je_id, v_offset_id, 0, v_amount, COALESCE(NULLIF(NEW.memo, ''), NEW.payee), NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

-- Re-create the trigger to fire on INSERT and UPDATE
DROP TRIGGER IF EXISTS auto_post_txn ON public.transactions;
CREATE TRIGGER auto_post_txn AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
