
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
  VALUES ('INV-' || NEW.invoice_number, NEW.date, 'Invoice ' || NEW.invoice_number || ' - ' || NEW.client, 'draft')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
  VALUES
    (v_je_id, v_ar_id, NEW.amount, 0, 'Invoice ' || NEW.invoice_number, NEW.job_id),
    (v_je_id, v_revenue_id, 0, NEW.amount, 'Invoice ' || NEW.invoice_number, NEW.job_id);

  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_je_id;

  RETURN NEW;
END;
$function$;
