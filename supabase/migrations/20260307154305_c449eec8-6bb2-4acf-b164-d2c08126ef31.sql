
-- Chart of Accounts
CREATE TABLE public.gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL DEFAULT 'expense',
  normal_balance text NOT NULL DEFAULT 'debit',
  parent_id uuid REFERENCES public.gl_accounts(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON public.gl_accounts FOR ALL USING (true) WITH CHECK (true);

-- Journal Entries (header)
CREATE TABLE public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL DEFAULT '',
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON public.journal_entries FOR ALL USING (true) WITH CHECK (true);

-- Journal Entry Lines
CREATE TABLE public.journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.gl_accounts(id),
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  job_id uuid REFERENCES public.jobs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON public.journal_entry_lines FOR ALL USING (true) WITH CHECK (true);
