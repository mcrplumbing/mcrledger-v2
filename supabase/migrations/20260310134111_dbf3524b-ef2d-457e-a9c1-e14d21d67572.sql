
-- Add version column for optimistic locking on key tables
ALTER TABLE public.transactions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.journal_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.vendor_invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.job_invoices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Create a trigger function for auto-incrementing version on update
CREATE OR REPLACE FUNCTION public.increment_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_transactions_version BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER trg_journal_entries_version BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER trg_vendor_invoices_version BEFORE UPDATE ON public.vendor_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
CREATE TRIGGER trg_job_invoices_version BEFORE UPDATE ON public.job_invoices FOR EACH ROW EXECUTE FUNCTION public.increment_version();
