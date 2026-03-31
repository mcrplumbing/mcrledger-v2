
-- PTO balances and accrual config per employee
CREATE TABLE public.employee_pto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pto_type text NOT NULL DEFAULT 'vacation',
  balance numeric NOT NULL DEFAULT 0,
  accrual_rate numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pto_type)
);

ALTER TABLE public.employee_pto ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON public.employee_pto
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PTO ledger for audit trail of accruals, usage, and manual adjustments
CREATE TABLE public.pto_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  pto_type text NOT NULL DEFAULT 'vacation',
  hours numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pto_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON public.pto_ledger
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
