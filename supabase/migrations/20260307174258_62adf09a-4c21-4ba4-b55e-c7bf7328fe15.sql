
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS allowances integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS pay_period text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS withholding_amount numeric NOT NULL DEFAULT 0;
