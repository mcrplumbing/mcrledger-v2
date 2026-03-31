
-- Drop all existing triggers first, then recreate
DO $$
DECLARE
  trig record;
BEGIN
  FOR trig IN 
    SELECT tgname, relname 
    FROM pg_trigger t 
    JOIN pg_class c ON t.tgrelid = c.oid 
    JOIN pg_namespace n ON c.relnamespace = n.oid 
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trig.tgname, trig.relname);
  END LOOP;
END $$;

-- Audit triggers for all 14 core tables
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- Period lock triggers
CREATE TRIGGER period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_timesheets BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER period_lock_payroll_runs BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- Version increment triggers
CREATE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- Auto-posting triggers
CREATE TRIGGER auto_post_transaction AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE TRIGGER auto_post_job_invoice AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE TRIGGER auto_post_vendor_invoice AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE TRIGGER auto_post_payroll AFTER UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
CREATE TRIGGER auto_post_received_payment AFTER INSERT ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.auto_post_received_payment();

-- JE balance validation
CREATE TRIGGER validate_je_lines BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
CREATE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();

-- =============================================
-- TIGHTEN RLS - Require authentication
-- =============================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'transactions','bank_accounts','bank_reconciliations','jobs',
    'job_invoices','vendor_invoices','vendors','employees',
    'employee_deductions','gl_accounts','journal_entries',
    'journal_entry_lines','loans','assets','payroll_runs',
    'payroll_entries','received_payments','timesheets','tax_settings'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow all access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Authenticated full access" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
