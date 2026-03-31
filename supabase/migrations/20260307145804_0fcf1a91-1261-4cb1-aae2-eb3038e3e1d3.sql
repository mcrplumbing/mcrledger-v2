
-- Enable RLS on all tables with permissive policies for now
-- Auth will be added later to restrict access

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;

-- Allow all operations for anon and authenticated (single-company app, auth added later)
CREATE POLICY "Allow all access" ON public.jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.timesheets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.tax_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.vendor_invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.assets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.loans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.payroll_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access" ON public.payroll_entries FOR ALL USING (true) WITH CHECK (true);
