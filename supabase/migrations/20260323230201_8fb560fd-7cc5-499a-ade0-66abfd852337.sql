
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

  -- Use draft-then-post pattern to avoid balance check during line inserts
  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES ('VI-' || NEW.invoice_no, NEW.date, 'Vendor invoice ' || NEW.invoice_no, 'draft')
  RETURNING id INTO v_je_id;

  INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, description, job_id)
  VALUES
    (v_je_id, v_expense_id, NEW.amount, 0, 'Vendor invoice ' || NEW.invoice_no, NEW.job_id),
    (v_je_id, v_ap_id, 0, NEW.amount, 'Vendor invoice ' || NEW.invoice_no, NEW.job_id);

  -- Now post — balance check will pass
  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_je_id;

  RETURN NEW;
END;
$function$;
