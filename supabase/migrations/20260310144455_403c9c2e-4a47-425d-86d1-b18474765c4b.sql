
-- Received payments table: holds payments until deposited
CREATE TABLE public.received_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.job_invoices(id) ON DELETE SET NULL,
  client text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'check',
  reference_no text NOT NULL DEFAULT '',
  memo text NOT NULL DEFAULT '',
  deposited boolean NOT NULL DEFAULT false,
  deposit_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.received_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON public.received_payments FOR ALL TO public USING (true) WITH CHECK (true);

-- Attach triggers to all tables (they keep getting dropped)
-- Audit triggers
CREATE OR REPLACE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE OR REPLACE TRIGGER audit_received_payments AFTER INSERT OR UPDATE OR DELETE ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- Period lock triggers
CREATE OR REPLACE TRIGGER period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE OR REPLACE TRIGGER period_lock_payroll BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- Version triggers
CREATE OR REPLACE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE OR REPLACE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- GL auto-post triggers
CREATE OR REPLACE TRIGGER auto_post_on_transaction AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE OR REPLACE TRIGGER auto_post_on_vendor_invoice AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE OR REPLACE TRIGGER auto_post_on_job_invoice AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE OR REPLACE TRIGGER auto_post_on_payroll AFTER UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
