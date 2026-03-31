
CREATE TABLE public.job_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text NOT NULL DEFAULT '',
  job_id uuid REFERENCES public.jobs(id),
  client text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  paid numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.job_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access" ON public.job_invoices FOR ALL USING (true) WITH CHECK (true);
