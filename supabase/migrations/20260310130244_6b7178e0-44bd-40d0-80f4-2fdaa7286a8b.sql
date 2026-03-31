
-- Bank reconciliations table
CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_date date NOT NULL,
  statement_balance numeric NOT NULL DEFAULT 0,
  cleared_balance numeric NOT NULL DEFAULT 0,
  difference numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'in_progress',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON public.bank_reconciliations FOR ALL TO public USING (true) WITH CHECK (true);

-- Add audit trigger
CREATE TRIGGER audit_bank_reconciliations
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
