
-- Create bank_accounts table
CREATE TABLE public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  routing_number TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'checking',
  opening_balance NUMERIC NOT NULL DEFAULT 0,
  next_check_number INTEGER NOT NULL DEFAULT 1001,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add bank_account_id to transactions (nullable for backward compat)
ALTER TABLE public.transactions ADD COLUMN bank_account_id UUID REFERENCES public.bank_accounts(id);

-- RLS: Allow all access (matches existing pattern)
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON public.bank_accounts FOR ALL TO public USING (true) WITH CHECK (true);
