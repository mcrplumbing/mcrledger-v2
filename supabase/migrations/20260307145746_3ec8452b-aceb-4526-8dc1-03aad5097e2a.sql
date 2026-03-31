
-- Jobs table
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on-hold')),
  budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Employees table
CREATE TABLE public.employees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  pay_type TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salary')),
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions (checkbook register)
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_no TEXT NOT NULL DEFAULT '',
  payee TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  job_id UUID REFERENCES public.jobs(id),
  deposit NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Timesheets (hours by employee by job)
CREATE TABLE public.timesheets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  job_id UUID NOT NULL REFERENCES public.jobs(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tax settings (federal/state tax tables, FICA rates)
CREATE TABLE public.tax_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('federal', 'state', 'fica_ss', 'fica_medicare', 'futa', 'suta')),
  bracket_min NUMERIC(12,2) NOT NULL DEFAULT 0,
  bracket_max NUMERIC(12,2),
  rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  filing_status TEXT NOT NULL DEFAULT 'single',
  effective_year INTEGER NOT NULL DEFAULT 2026,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vendors
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vendor invoices (with job tracking)
CREATE TABLE public.vendor_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),
  job_id UUID REFERENCES public.jobs(id),
  invoice_no TEXT NOT NULL DEFAULT '',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assets
CREATE TABLE public.assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  purchase_date DATE,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  depreciation_method TEXT NOT NULL DEFAULT 'Straight-line',
  assigned_to TEXT NOT NULL DEFAULT '',
  job_id UUID REFERENCES public.jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Loans
CREATE TABLE public.loans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'payable' CHECK (type IN ('payable', 'receivable')),
  principal NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  rate NUMERIC(6,3) NOT NULL DEFAULT 0,
  payment NUMERIC(12,2) NOT NULL DEFAULT 0,
  next_due DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payroll runs
CREATE TABLE public.payroll_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payroll entries (per employee per run)
CREATE TABLE public.payroll_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payroll_run_id UUID NOT NULL REFERENCES public.payroll_runs(id),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  fed_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  state_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  fica NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
