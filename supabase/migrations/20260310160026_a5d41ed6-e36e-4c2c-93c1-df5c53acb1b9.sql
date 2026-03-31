
-- Drop and recreate all triggers to ensure correct attachment
-- AUDIT TRIGGERS
DROP TRIGGER IF EXISTS audit_transactions ON public.transactions;
DROP TRIGGER IF EXISTS audit_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS audit_journal_entry_lines ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS audit_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS audit_vendor_invoices ON public.vendor_invoices;
DROP TRIGGER IF EXISTS audit_vendors ON public.vendors;
DROP TRIGGER IF EXISTS audit_employees ON public.employees;
DROP TRIGGER IF EXISTS audit_payroll_runs ON public.payroll_runs;
DROP TRIGGER IF EXISTS audit_payroll_entries ON public.payroll_entries;
DROP TRIGGER IF EXISTS audit_bank_accounts ON public.bank_accounts;
DROP TRIGGER IF EXISTS audit_received_payments ON public.received_payments;
DROP TRIGGER IF EXISTS audit_assets ON public.assets;
DROP TRIGGER IF EXISTS audit_loans ON public.loans;
DROP TRIGGER IF EXISTS audit_gl_accounts ON public.gl_accounts;

-- PERIOD LOCK TRIGGERS
DROP TRIGGER IF EXISTS enforce_period_lock_transactions ON public.transactions;
DROP TRIGGER IF EXISTS enforce_period_lock_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS enforce_period_lock_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS enforce_period_lock_vendor_invoices ON public.vendor_invoices;
DROP TRIGGER IF EXISTS enforce_period_lock_timesheets ON public.timesheets;
DROP TRIGGER IF EXISTS enforce_period_lock_received_payments ON public.received_payments;
DROP TRIGGER IF EXISTS enforce_period_lock_payroll ON public.payroll_runs;

-- VERSION TRIGGERS
DROP TRIGGER IF EXISTS version_transactions ON public.transactions;
DROP TRIGGER IF EXISTS version_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS version_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS version_vendor_invoices ON public.vendor_invoices;

-- AUTO-POST TRIGGERS
DROP TRIGGER IF EXISTS auto_post_transaction ON public.transactions;
DROP TRIGGER IF EXISTS auto_post_job_invoice ON public.job_invoices;
DROP TRIGGER IF EXISTS auto_post_vendor_invoice ON public.vendor_invoices;
DROP TRIGGER IF EXISTS auto_post_payroll_run ON public.payroll_runs;
DROP TRIGGER IF EXISTS auto_post_received_payment ON public.received_payments;

-- VALIDATION TRIGGERS
DROP TRIGGER IF EXISTS validate_je_balance ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS validate_je_status ON public.journal_entries;

-- NOW RECREATE ALL
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_received_payments AFTER INSERT OR UPDATE OR DELETE ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE TRIGGER enforce_period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_timesheets BEFORE INSERT OR UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_received_payments BEFORE INSERT OR UPDATE ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_payroll BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

CREATE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

CREATE TRIGGER auto_post_transaction AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE TRIGGER auto_post_job_invoice AFTER INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
CREATE TRIGGER auto_post_vendor_invoice AFTER INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE TRIGGER auto_post_payroll_run AFTER UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
CREATE TRIGGER auto_post_received_payment AFTER INSERT ON public.received_payments FOR EACH ROW EXECUTE FUNCTION public.auto_post_received_payment();

CREATE TRIGGER validate_je_balance BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
CREATE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();
