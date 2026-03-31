
-- Create a table to track automated backup runs
CREATE TABLE public.backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  tables_backed_up integer NOT NULL DEFAULT 0,
  total_records integer NOT NULL DEFAULT 0,
  storage_path text NOT NULL DEFAULT '',
  error text
);

ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage backups" ON public.backup_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read backups" ON public.backup_runs
  FOR SELECT TO authenticated
  USING (true);
