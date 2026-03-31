
CREATE TABLE public.employee_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  deduction_type text NOT NULL DEFAULT 'other',
  description text NOT NULL DEFAULT '',
  calc_method text NOT NULL DEFAULT 'flat',
  amount numeric NOT NULL DEFAULT 0,
  percentage numeric NOT NULL DEFAULT 0,
  pre_tax boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  max_annual numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON public.employee_deductions FOR ALL USING (true) WITH CHECK (true);

COMMENT ON COLUMN public.employee_deductions.deduction_type IS 'Type: 401k, garnishment, health_insurance, dental_insurance, vision_insurance, union_dues, hsa, other';
COMMENT ON COLUMN public.employee_deductions.calc_method IS 'flat = fixed dollar amount, percentage = % of gross pay';
COMMENT ON COLUMN public.employee_deductions.priority IS 'Order of deduction processing, lower = first. Garnishments often have court-mandated priority';
COMMENT ON COLUMN public.employee_deductions.max_annual IS 'Annual cap (e.g. 401k IRS limit). NULL = no cap';
