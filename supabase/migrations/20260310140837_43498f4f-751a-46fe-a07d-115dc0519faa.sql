
-- Drop any existing triggers first to avoid conflicts
DROP TRIGGER IF EXISTS audit_transactions ON public.transactions;
DROP TRIGGER IF EXISTS audit_employees ON public.employees;
DROP TRIGGER IF EXISTS audit_gl_accounts ON public.gl_accounts;
DROP TRIGGER IF EXISTS audit_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS audit_journal_entry_lines ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS audit_jobs ON public.jobs;
DROP TRIGGER IF EXISTS audit_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS audit_vendor_invoices ON public.vendor_invoices;
DROP TRIGGER IF EXISTS audit_vendors ON public.vendors;
DROP TRIGGER IF EXISTS audit_bank_accounts ON public.bank_accounts;
DROP TRIGGER IF EXISTS audit_payroll_runs ON public.payroll_runs;
DROP TRIGGER IF EXISTS audit_payroll_entries ON public.payroll_entries;
DROP TRIGGER IF EXISTS audit_assets ON public.assets;
DROP TRIGGER IF EXISTS audit_loans ON public.loans;
DROP TRIGGER IF EXISTS enforce_period_lock_transactions ON public.transactions;
DROP TRIGGER IF EXISTS enforce_period_lock_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS enforce_period_lock_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS enforce_period_lock_vendor_invoices ON public.vendor_invoices;
DROP TRIGGER IF EXISTS enforce_period_lock_payroll ON public.payroll_runs;
DROP TRIGGER IF EXISTS version_transactions ON public.transactions;
DROP TRIGGER IF EXISTS version_journal_entries ON public.journal_entries;
DROP TRIGGER IF EXISTS version_job_invoices ON public.job_invoices;
DROP TRIGGER IF EXISTS version_vendor_invoices ON public.vendor_invoices;
DROP TRIGGER IF EXISTS validate_je_balance ON public.journal_entry_lines;
DROP TRIGGER IF EXISTS validate_je_status ON public.journal_entries;
DROP TRIGGER IF EXISTS auto_post_transaction ON public.transactions;
DROP TRIGGER IF EXISTS auto_post_vendor_invoice ON public.vendor_invoices;
DROP TRIGGER IF EXISTS auto_post_job_invoice ON public.job_invoices;
DROP TRIGGER IF EXISTS auto_post_payroll ON public.payroll_runs;

-- Audit triggers
CREATE TRIGGER audit_transactions AFTER INSERT OR UPDATE OR DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON public.gl_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entries AFTER INSERT OR UPDATE OR DELETE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_journal_entry_lines AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_job_invoices AFTER INSERT OR UPDATE OR DELETE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendor_invoices AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_runs AFTER INSERT OR UPDATE OR DELETE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_payroll_entries AFTER INSERT OR UPDATE OR DELETE ON public.payroll_entries FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_assets AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_loans AFTER INSERT OR UPDATE OR DELETE ON public.loans FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- Period lock triggers
CREATE TRIGGER enforce_period_lock_transactions BEFORE INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_journal_entries BEFORE INSERT OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_job_invoices BEFORE INSERT OR UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_vendor_invoices BEFORE INSERT OR UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock();
CREATE TRIGGER enforce_period_lock_payroll BEFORE INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.enforce_period_lock_payroll();

-- Version increment triggers
CREATE TRIGGER version_transactions BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_journal_entries BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_job_invoices BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER version_vendor_invoices BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();

-- Journal entry balance validation
CREATE TRIGGER validate_je_balance BEFORE INSERT OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.validate_journal_entry_balance();
CREATE TRIGGER validate_je_status BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.validate_je_status_change();

-- Auto-post triggers
CREATE TRIGGER auto_post_transaction AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();
CREATE TRIGGER auto_post_vendor_invoice AFTER INSERT ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();
CREATE TRIGGER auto_post_job_invoice AFTER INSERT ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();

-- 1099 vendor tracking
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '';
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS is_1099 boolean NOT NULL DEFAULT false;

-- Pay Bills link
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS vendor_invoice_id uuid REFERENCES public.vendor_invoices(id);

-- Payroll auto-post function
CREATE OR REPLACE FUNCTION public.auto_post_payroll_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_je_id uuid;
  v_cash_id uuid;
  v_expense_id uuid;
  v_fed_liability_id uuid;
  v_state_liability_id uuid;
  v_fica_liability_id uuid;
  v_total_gross numeric := 0;
  v_total_net numeric := 0;
  v_total_fed numeric := 0;
  v_total_state numeric := 0;
  v_total_fica numeric := 0;
  v_entry_prefix text;
BEGIN
  IF NEW.status NOT IN ('posted', 'reversal') THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(gross_pay),0), COALESCE(SUM(net_pay),0), COALESCE(SUM(fed_tax),0), COALESCE(SUM(state_tax),0), COALESCE(SUM(fica),0)
  INTO v_total_gross, v_total_net, v_total_fed, v_total_state, v_total_fica
  FROM public.payroll_entries WHERE payroll_run_id = NEW.id;

  IF v_total_gross = 0 THEN RETURN NEW; END IF;

  v_cash_id := public.find_gl_account('1000');
  IF v_cash_id IS NULL THEN v_cash_id := (SELECT id FROM public.gl_accounts WHERE account_type='asset' AND active=true ORDER BY account_number LIMIT 1); END IF;
  
  v_expense_id := (SELECT id FROM public.gl_accounts WHERE active=true AND (account_number='6100' OR name ILIKE '%payroll%') ORDER BY account_number LIMIT 1);
  IF v_expense_id IS NULL THEN v_expense_id := (SELECT id FROM public.gl_accounts WHERE account_type='expense' AND active=true ORDER BY account_number LIMIT 1); END IF;
  
  v_fed_liability_id := (SELECT id FROM public.gl_accounts WHERE active=true AND (account_number='2100' OR name ILIKE '%federal%payable%') ORDER BY account_number LIMIT 1);
  IF v_fed_liability_id IS NULL THEN v_fed_liability_id := (SELECT id FROM public.gl_accounts WHERE account_type='liability' AND active=true ORDER BY account_number LIMIT 1); END IF;
  
  v_state_liability_id := COALESCE((SELECT id FROM public.gl_accounts WHERE active=true AND (account_number='2110' OR name ILIKE '%state%payable%') ORDER BY account_number LIMIT 1), v_fed_liability_id);
  v_fica_liability_id := COALESCE((SELECT id FROM public.gl_accounts WHERE active=true AND (account_number='2120' OR name ILIKE '%fica%payable%') ORDER BY account_number LIMIT 1), v_fed_liability_id);

  IF v_cash_id IS NULL OR v_expense_id IS NULL OR v_fed_liability_id IS NULL THEN RETURN NEW; END IF;

  v_entry_prefix := CASE WHEN NEW.status='reversal' THEN 'PR-REV-' ELSE 'PR-' END;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES (v_entry_prefix || to_char(NEW.period_end,'YYYYMMDD'), NEW.run_date, 'Payroll '||NEW.period_start||' to '||NEW.period_end, 'posted')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_expense_id, ABS(v_total_gross), 0, 'Payroll gross wages');
  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cash_id, 0, ABS(v_total_net), 'Payroll net pay');
  IF v_total_fed != 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_fed_liability_id, 0, ABS(v_total_fed), 'Federal tax withheld');
  END IF;
  IF v_total_state != 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_state_liability_id, 0, ABS(v_total_state), 'State tax withheld');
  END IF;
  IF v_total_fica != 0 THEN
    INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_fica_liability_id, 0, ABS(v_total_fica), 'FICA withheld');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_post_payroll AFTER INSERT OR UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.auto_post_payroll_run();
