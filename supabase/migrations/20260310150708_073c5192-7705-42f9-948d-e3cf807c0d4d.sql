
-- ============================================
-- TRIGGER RESTORATION (permanent)
-- ============================================

-- Audit triggers on all 14+ tables
CREATE OR REPLACE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_timesheets AFTER INSERT OR UPDATE OR DELETE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_received_payments AFTER INSERT OR UPDATE OR DELETE ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- Period lock triggers
CREATE OR REPLACE TRIGGER period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_timesheets BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_received_payments BEFORE INSERT OR UPDATE ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_payroll_runs BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- Version increment triggers
CREATE OR REPLACE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- Auto-post triggers
CREATE OR REPLACE TRIGGER auto_post_txn AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE OR REPLACE TRIGGER auto_post_payroll AFTER UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
CREATE OR REPLACE TRIGGER auto_post_vi AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE OR REPLACE TRIGGER auto_post_ji AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();

-- JE validation triggers
CREATE OR REPLACE TRIGGER validate_je_balance BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
CREATE OR REPLACE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();

-- ============================================
-- Undeposited Funds GL trigger
-- When payment received: DR Undeposited Funds (1200), CR AR (1100)
-- ============================================
CREATE OR REPLACE FUNCTION public.auto_post_received_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_undeposited_id uuid;
  v_ar_id uuid;
  v_je_id uuid;
BEGIN
  IF NEW.amount <= 0 THEN RETURN NEW; END IF;

  v_undeposited_id := public.find_gl_account('1200');
  v_ar_id := public.find_gl_account('1100');

  IF v_undeposited_id IS NULL OR v_ar_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES ('RCP-' || LEFT(NEW.id::text, 8), NEW.payment_date, 'Payment received: ' || NEW.client || ' (' || NEW.payment_method || ')', 'posted')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES
    (v_je_id, v_undeposited_id, NEW.amount, 0, 'Payment from ' || NEW.client),
    (v_je_id, v_ar_id, 0, NEW.amount, 'Payment from ' || NEW.client);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER auto_post_received_payment AFTER INSERT ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.auto_post_received_payment();

-- ============================================
-- When deposit is made: void the undeposited funds JE per payment
-- The deposit transaction trigger already posts DR Cash CR Revenue
-- We need to adjust: DR Cash CR Undeposited Funds (not revenue)
-- We'll handle this by having the deposit transaction use gl_account_id = 1200
-- This is handled in the MakeDeposit code, not a trigger
-- ============================================
