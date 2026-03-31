import type { Database } from "./types";

// Base row types for convenience
type Tables = Database["public"]["Tables"];
export type Employee = Tables["employees"]["Row"];
export type Job = Tables["jobs"]["Row"];
export type Vendor = Tables["vendors"]["Row"];
export type Transaction = Tables["transactions"]["Row"];
export type PayrollEntry = Tables["payroll_entries"]["Row"];
export type PayrollRun = Tables["payroll_runs"]["Row"];
export type JournalEntry = Tables["journal_entries"]["Row"];
export type JournalEntryLine = Tables["journal_entry_lines"]["Row"];
export type JobInvoice = Tables["job_invoices"]["Row"];
export type VendorInvoice = Tables["vendor_invoices"]["Row"];
export type GlAccount = Tables["gl_accounts"]["Row"];
export type Timesheet = Tables["timesheets"]["Row"];
export type ReceivedPayment = Tables["received_payments"]["Row"];

// Common join shapes returned by Supabase .select("*, related(cols)")
export type PayrollEntryWithEmployee = PayrollEntry & {
  employees: Pick<Employee, "name" | "employee_number"> | null;
};

export type TransactionWithJob = Transaction & {
  jobs: Pick<Job, "job_number" | "name"> | null;
};

export type VendorInvoiceWithRelations = VendorInvoice & {
  vendors: Pick<Vendor, "name"> | null;
  jobs: Pick<Job, "job_number"> | null;
};

export type TimesheetWithEmployee = Timesheet & {
  employees: Pick<Employee, "rate" | "pay_type"> | null;
};

export type PayrollEntryWithRun = PayrollEntry & {
  payroll_runs: Pick<PayrollRun, "period_end"> | null;
};

export type PayrollEntryWithEmployeeDetail = PayrollEntry & {
  employees: Pick<Employee, "name" | "role" | "employee_number"> | null;
};

export type PayrollRunWithEntries = PayrollRun & {
  payroll_entries: PayrollEntryWithEmployeeDetail[];
};

export type PayrollRunWithEntriesBasic = PayrollRun & {
  payroll_entries: PayrollEntry[];
};

export type JournalEntryWithLines = JournalEntry & {
  journal_entry_lines: JournalEntryLine[];
};

export type JobInvoiceWithJob = JobInvoice & {
  jobs: Pick<Job, "job_number" | "name"> | null;
};

export type ReceivedPaymentWithInvoice = ReceivedPayment & {
  job_invoices: Pick<JobInvoice, "invoice_number"> | null;
};
