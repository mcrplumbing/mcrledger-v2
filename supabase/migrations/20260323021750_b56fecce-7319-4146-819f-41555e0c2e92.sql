
CREATE OR REPLACE FUNCTION public.auto_post_payroll_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NEW.status NOT IN ('posted', 'paid', 'reversal') THEN RETURN NEW; END IF;
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

  -- Insert as DRAFT first to avoid balance check trigger
  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES (v_entry_prefix || to_char(NEW.period_end,'YYYYMMDD'), NEW.run_date, 'Payroll '||NEW.period_start||' to '||NEW.period_end, 'draft')
  RETURNING id INTO v_je_id;

  -- Insert all lines while still draft
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

  -- Now post it — balance check will pass since lines exist
  UPDATE public.journal_entries SET status = 'posted' WHERE id = v_je_id;

  RETURN NEW;
END;
$function$;
