
CREATE TABLE public.tax_parse_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'processing',
  tax_type text NOT NULL,
  effective_year integer NOT NULL DEFAULT 2026,
  state_name text,
  input_text text NOT NULL,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_parse_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert jobs"
  ON public.tax_parse_jobs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read jobs"
  ON public.tax_parse_jobs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can update jobs"
  ON public.tax_parse_jobs FOR UPDATE
  USING (true)
  WITH CHECK (true);
