
-- Helper: find GL account by account_number or name pattern
CREATE OR REPLACE FUNCTION public.find_gl_account(p_pattern text)
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT id FROM public.gl_accounts
  WHERE active = true
  AND (account_number = p_pattern OR name ILIKE '%' || p_pattern || '%')
  ORDER BY account_number
  LIMIT 1;
$$;

-- Auto-post from checkbook transactions
CREATE OR REPLACE FUNCTION public.auto_post_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash_id uuid;
  v_offset_id uuid;
  v_je_id uuid;
  v_amount numeric;
  v_is_payment boolean;
BEGIN
  v_cash_id := public.find_gl_account('1000');
  IF v_cash_id IS NULL THEN
    v_cash_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'asset' AND active = true ORDER BY account_number LIMIT 1);
  END IF;
  IF v_cash_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.payment > 0 THEN
    v_is_payment := true;
    v_amount := NEW.payment;
    v_offset_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'expense' AND active = true ORDER BY account_number LIMIT 1);
  ELSIF NEW.deposit > 0 THEN
    v_is_payment := false;
    v_amount := NEW.deposit;
    v_offset_id := (SELECT id FROM public.gl_accounts WHERE account_type = 'revenue' AND active = true ORDER BY account_number LIMIT 1);
  ELSE
    RETURN NEW;
  END IF;

  IF v_offset_id IS NULL OR v_amount <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES (
    'CHK-' || COALESCE(NULLIF(NEW.check_no, ''), LEFT(NEW.id::text, 8)),
    NEW.date,
    COALESCE(NULLIF(NEW.memo, ''), NEW.payee),
    'posted'
  )
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
$$;

-- Auto-post from vendor invoices (DR Expense, CR AP)
CREATE OR REPLACE FUNCTION public.auto_post_vendor_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap_id uuid;
  v_expense_id uuid;
  v_je_id uuid;
BEGIN
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
$$;

-- Auto-post from customer invoices (DR AR, CR Revenue)
CREATE OR REPLACE FUNCTION public.auto_post_job_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar_id uuid;
  v_revenue_id uuid;
  v_je_id uuid;
BEGIN
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
$$;

-- Attach triggers
CREATE TRIGGER auto_post_transaction_trigger
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_post_transaction();

CREATE TRIGGER auto_post_vendor_invoice_trigger
  AFTER INSERT ON public.vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.auto_post_vendor_invoice();

CREATE TRIGGER auto_post_job_invoice_trigger
  AFTER INSERT ON public.job_invoices
  FOR EACH ROW EXECUTE FUNCTION public.auto_post_job_invoice();
