ALTER TABLE public.payroll_entries 
  ADD COLUMN ss_tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN medicare_tax numeric NOT NULL DEFAULT 0,
  ADD COLUMN sdi_tax numeric NOT NULL DEFAULT 0;