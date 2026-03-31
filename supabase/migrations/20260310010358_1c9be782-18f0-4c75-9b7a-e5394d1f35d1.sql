
ALTER TABLE public.employees 
  ADD COLUMN IF NOT EXISTS filing_status text NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS pay_period text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS withholding_allowances integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'CA';
