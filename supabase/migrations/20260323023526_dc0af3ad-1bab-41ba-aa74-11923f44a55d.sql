-- Fix checkbook auto-posting so payroll checks and other transactions create balanced journal entries
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
  v_entry_status text := 'draft';
BEGIN
  v_cash_id := public.find_gl_account('1000');
  IF v_cash_id IS NULL THEN
    v_cash_id := (
      SELECT id
      FROM public.gl_accounts
      WHERE account_type = 'asset' AND active = true
      ORDER BY account_number
      LIMIT 1
    );
  END IF;
  IF v_cash_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment > 0 THEN
    v_is_payment := true;
    v_amount := NEW.payment;
    v_offset_id := COALESCE(
      NEW.gl_account_id,
      (
        SELECT id
        FROM public.gl_accounts
        WHERE account_type = 'expense' AND active = true
        ORDER BY account_number
        LIMIT 1
      )
    );
  ELSIF NEW.deposit > 0 THEN
    v_is_payment := false;
    v_amount := NEW.deposit;
    v_offset_id := COALESCE(
      NEW.gl_account_id,
      (
        SELECT id
        FROM public.gl_accounts
        WHERE account_type = 'revenue' AND active = true
        ORDER BY account_number
        LIMIT 1
      )
    );
  ELSE
    RETURN NEW;
  END IF;

  IF v_offset_id IS NULL OR v_amount <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.journal_entries (entry_number, date, description, status)
  VALUES (
    'CHK-' || COALESCE(NULLIF(NEW.check_no, ''), LEFT(NEW.id::text, 8)),
    NEW.date,
    COALESCE(NULLIF(NEW.memo, ''), NEW.payee),
    v_entry_status
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

  UPDATE public.journal_entries
  SET status = 'posted'
  WHERE id = v_je_id;

  RETURN NEW;
END;
$$;