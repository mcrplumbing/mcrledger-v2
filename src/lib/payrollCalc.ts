import { supabase } from "@/integrations/supabase/client";

export interface TaxBracket {
  bracket_min: number;
  bracket_max: number | null;
  rate: number;
  withholding_amount: number;
}

export interface EmployeeTaxInfo {
  filing_status: string;
  pay_period: string;
  withholding_allowances: number;
  state: string;
}

export interface DeductionDetail {
  type: string;
  description: string;
  amount: number;
  pre_tax: boolean;
}

export interface PayrollCalcResult {
  gross_pay: number;
  fed_tax: number;
  state_tax: number;
  ss_tax: number;
  medicare_tax: number;
  sdi_tax: number;
  fica: number;
  deductions_pretax: number;
  deductions_posttax: number;
  deduction_details: DeductionDetail[];
  net_pay: number;
}

/* ── Pay-period helpers ───────────────────────────────────── */

const PERIODS_PER_YEAR: Record<string, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

/* ── 2026 IRS Pub 15-T STANDARD Withholding Rate Schedules (ANNUAL) ── */

const FED_ANNUAL_BRACKETS_2026: Record<
  string,
  { min: number; max: number | null; base: number; rate: number }[]
> = {
  single: [
    { min: 0, max: 7500, base: 0, rate: 0 },
    { min: 7500, max: 19900, base: 0, rate: 0.10 },
    { min: 19900, max: 57900, base: 1240, rate: 0.12 },
    { min: 57900, max: 113200, base: 5800, rate: 0.22 },
    { min: 113200, max: 209275, base: 17966, rate: 0.24 },
    { min: 209275, max: 263725, base: 41024, rate: 0.32 },
    { min: 263725, max: 648100, base: 58448, rate: 0.35 },
    { min: 648100, max: null, base: 192979.25, rate: 0.37 },
  ],
  married: [
    { min: 0, max: 19300, base: 0, rate: 0 },
    { min: 19300, max: 44100, base: 0, rate: 0.10 },
    { min: 44100, max: 120100, base: 2480, rate: 0.12 },
    { min: 120100, max: 230700, base: 11600, rate: 0.22 },
    { min: 230700, max: 422850, base: 35932, rate: 0.24 },
    { min: 422850, max: 531750, base: 82048, rate: 0.32 },
    { min: 531750, max: 788000, base: 116896, rate: 0.35 },
    { min: 788000, max: null, base: 206583.50, rate: 0.37 },
  ],
};

/**
 * Pub 15-T Step 1 adjustment.
 * New W-4 (2020+) with Step 2 NOT checked: $8,600 (S) / $12,900 (MFJ)
 * Old W-4 (pre-2020): allowances × $4,300
 */
const FED_STD_ADJUSTMENT: Record<string, number> = {
  single: 8600,
  married: 12900,
};
const FED_ALLOWANCE_VALUE = 4300;

/* ── 2026 California DE 44 Method B (Exact Calculation) ───── */

/**
 * CA annual income tax brackets (2026).
 * Source: EDD DE 44 / FTB 2026 tax rate schedules (Method B, Tables 5 & 6).
 */
const CA_ANNUAL_BRACKETS_2026: Record<
  string,
  { min: number; max: number | null; base: number; rate: number }[]
> = {
  single: [
    { min: 0, max: 11079, base: 0, rate: 0.011 },
    { min: 11079, max: 26264, base: 121.87, rate: 0.022 },
    { min: 26264, max: 41452, base: 455.94, rate: 0.044 },
    { min: 41452, max: 57542, base: 1124.21, rate: 0.066 },
    { min: 57542, max: 72724, base: 2186.15, rate: 0.088 },
    { min: 72724, max: 371479, base: 3522.17, rate: 0.1023 },
    { min: 371479, max: 445771, base: 34084.81, rate: 0.1133 },
    { min: 445771, max: 742953, base: 42502.09, rate: 0.1243 },
    { min: 742953, max: 1000000, base: 79441.81, rate: 0.1353 },
    { min: 1000000, max: null, base: 114220.27, rate: 0.1463 },
  ],
  married: [
    { min: 0, max: 22158, base: 0, rate: 0.011 },
    { min: 22158, max: 52528, base: 243.74, rate: 0.022 },
    { min: 52528, max: 82904, base: 911.88, rate: 0.044 },
    { min: 82904, max: 115084, base: 2248.42, rate: 0.066 },
    { min: 115084, max: 145448, base: 4372.30, rate: 0.088 },
    { min: 145448, max: 742958, base: 7044.33, rate: 0.1023 },
    { min: 742958, max: 891542, base: 68169.60, rate: 0.1133 },
    { min: 891542, max: 1000000, base: 85004.17, rate: 0.1243 },
    { min: 1000000, max: 1485906, base: 98485.50, rate: 0.1353 },
    { min: 1485906, max: null, base: 164228.58, rate: 0.1463 },
  ],
};

/** CA standard deduction (annual, 2026). */
const CA_STD_DEDUCTION: Record<string, number> = {
  single: 5706,
  married: 11412,
};

/** CA low-income exemption threshold (annual, 2026). */
const CA_LOW_INCOME_EXEMPT: Record<string, number> = {
  single: 18896,
  married: 37791,
};

/** CA exemption allowance credit (annual per regular allowance, 2026). */
const CA_EXEMPTION_CREDIT_PER_ALLOWANCE = 168.30;

/** CA SDI rate for 2026 — no wage cap. */
const CA_SDI_RATE = 0.012;

/* ── 2026 FICA constants ─────────────────────────────────── */

/** Social Security tax rate (employee share). */
const SS_RATE = 0.062;
/** Social Security annual wage base for 2026. */
const SS_WAGE_BASE_2026 = 184500;

/** Medicare tax rate (employee share). */
const MEDICARE_RATE = 0.0145;
/** Additional Medicare tax rate (0.9% on wages over $200k). */
const ADDITIONAL_MEDICARE_RATE = 0.009;
/** Additional Medicare threshold (annual). */
const ADDITIONAL_MEDICARE_THRESHOLD = 200000;

/**
 * Apply a cumulative-base bracket table to an amount.
 * Each bracket has: min, max, base (cumulative tax at bracket start), rate.
 */
function applyAnnualBrackets(
  amount: number,
  brackets: { min: number; max: number | null; base: number; rate: number }[]
): number {
  if (amount <= 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    if (amount <= b.min) break;
    if (amount > b.min) {
      const upper = b.max != null ? Math.min(amount, b.max) : amount;
      tax = b.base + (upper - b.min) * b.rate;
    }
  }
  return tax;
}

/**
 * Federal withholding — IRS Pub 15-T annualize method.
 */
function calcFederalTax(
  annualTaxableWages: number,
  filingStatus: string,
  withholding_allowances: number,
  periods: number
): number {
  const adjustment =
    withholding_allowances > 0
      ? withholding_allowances * FED_ALLOWANCE_VALUE
      : FED_STD_ADJUSTMENT[filingStatus] || FED_STD_ADJUSTMENT.single;

  const adjustedAnnualWage = Math.max(0, annualTaxableWages - adjustment);
  const brackets =
    FED_ANNUAL_BRACKETS_2026[filingStatus] || FED_ANNUAL_BRACKETS_2026.single;
  const annualTax = applyAnnualBrackets(adjustedAnnualWage, brackets);
  return Math.round((annualTax / periods) * 100) / 100;
}

/**
 * California state income tax — DE 44 Method B (annualize).
 * 1. Annualize taxable wages (after pre-tax deductions)
 * 2. If below low-income threshold → $0
 * 3. Subtract standard deduction
 * 4. Apply annual brackets
 * 5. Subtract exemption allowance credit (from TAX, not income)
 * 6. De-annualize
 */
function calcCaliforniaTax(
  annualTaxableWages: number,
  filingStatus: string,
  withholding_allowances: number,
  periods: number
): number {
  const lowIncomeThreshold =
    CA_LOW_INCOME_EXEMPT[filingStatus] || CA_LOW_INCOME_EXEMPT.single;
  if (annualTaxableWages <= lowIncomeThreshold) return 0;

  const stdDeduction =
    CA_STD_DEDUCTION[filingStatus] || CA_STD_DEDUCTION.single;
  const taxableIncome = Math.max(0, annualTaxableWages - stdDeduction);

  const brackets =
    CA_ANNUAL_BRACKETS_2026[filingStatus] || CA_ANNUAL_BRACKETS_2026.single;
  let annualTax = applyAnnualBrackets(taxableIncome, brackets);

  // Exemption allowance credit — subtracted from computed tax
  const exemptionCredit =
    (withholding_allowances || 0) * CA_EXEMPTION_CREDIT_PER_ALLOWANCE;
  annualTax = Math.max(0, annualTax - exemptionCredit);

  return Math.round((annualTax / periods) * 100) / 100;
}

/* ── DB helpers ───────────────────────────────────────────── */

/**
 * Apply progressive per-period tax brackets (used for FICA from DB).
 */
function applyBrackets(amount: number, brackets: TaxBracket[]): number {
  if (amount <= 0) return 0;
  let tax = 0;
  const sorted = [...brackets].sort((a, b) => a.bracket_min - b.bracket_min);
  for (const b of sorted) {
    if (amount <= b.bracket_min) break;
    const upper =
      b.bracket_max != null ? Math.min(amount, b.bracket_max) : amount;
    const taxableInBracket = upper - b.bracket_min;
    if (taxableInBracket <= 0) continue;
    if (b.withholding_amount > 0) {
      tax += b.withholding_amount;
    } else {
      tax += taxableInBracket * b.rate;
    }
  }
  return Math.round(tax * 100) / 100;
}

async function fetchBrackets(
  taxType: string,
  filingStatus: string,
  payPeriod: string,
  year: number
): Promise<TaxBracket[]> {
  const { data, error } = await supabase
    .from("tax_settings")
    .select("bracket_min, bracket_max, rate, withholding_amount")
    .eq("tax_type", taxType)
    .eq("filing_status", filingStatus)
    .eq("pay_period", payPeriod)
    .eq("effective_year", year)
    .order("bracket_min");

  if (error) {
    console.error(`Error fetching ${taxType} brackets:`, error);
    return [];
  }
  return (data || []) as TaxBracket[];
}

async function fetchDeductions(employeeId: string) {
  const { data, error } = await supabase
    .from("employee_deductions")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("active", true)
    .order("priority");

  if (error) {
    console.error("Error fetching deductions:", error);
    return [];
  }
  return data || [];
}

function calcDeductionAmount(deduction: any, grossPay: number): number {
  if (deduction.calc_method === "percentage") {
    return Math.round(grossPay * (deduction.percentage / 100) * 100) / 100;
  }
  return deduction.amount || 0;
}

/* ── Main entry point ─────────────────────────────────────── */

/**
 * Calculate full payroll for one employee for one pay period.
 */
export async function calculatePayroll(
  employeeId: string,
  grossPay: number,
  taxInfo: EmployeeTaxInfo,
  taxYear: number = 2026
): Promise<PayrollCalcResult> {
  const periods = PERIODS_PER_YEAR[taxInfo.pay_period] || 52;

  // 1. Fetch deductions
  const deductions = await fetchDeductions(employeeId);

  // 2. Calculate deductions
  const preTaxDeductions = deductions.filter((d: any) => d.pre_tax);
  const postTaxDeductions = deductions.filter((d: any) => !d.pre_tax);
  const ficaExemptDeductions = deductions.filter(
    (d: any) => d.pre_tax && d.reduces_fica
  );

  const deduction_details: DeductionDetail[] = [];

  let deductions_pretax = 0;
  for (const d of preTaxDeductions) {
    const amt = calcDeductionAmount(d, grossPay);
    deductions_pretax += amt;
    deduction_details.push({ type: d.deduction_type, description: d.description, amount: amt, pre_tax: true });
  }

  let ficaExemptAmount = 0;
  for (const d of ficaExemptDeductions) {
    ficaExemptAmount += calcDeductionAmount(d, grossPay);
  }

  let deductions_posttax = 0;
  for (const d of postTaxDeductions) {
    const amt = calcDeductionAmount(d, grossPay);
    deductions_posttax += amt;
    deduction_details.push({ type: d.deduction_type, description: d.description, amount: amt, pre_tax: false });
  }

  // 3. Federal income tax — IRS Pub 15-T annualize method
  const taxableWagesPerPeriod = Math.max(0, grossPay - deductions_pretax);
  const annualTaxableWages = taxableWagesPerPeriod * periods;
  const fed_tax = calcFederalTax(
    annualTaxableWages,
    taxInfo.filing_status,
    taxInfo.withholding_allowances,
    periods
  );

  // 4. California state income tax — DE 44 Method B (annualize)
  const state_tax = calcCaliforniaTax(
    annualTaxableWages,
    taxInfo.filing_status,
    taxInfo.withholding_allowances,
    periods
  );

  // 5. FICA — flat rates on gross minus Section 125 deductions only
  const ficaWages = Math.max(0, grossPay - ficaExemptAmount);

  // Social Security: 6.2% (cap applied on YTD basis — for now, apply flat rate)
  const ss_tax = Math.round(ficaWages * SS_RATE * 100) / 100;

  // Medicare: 1.45% flat (additional 0.9% only after YTD exceeds $200k — not applied per-period)
  const medicare_tax = Math.round(ficaWages * MEDICARE_RATE * 100) / 100;

  const fica = Math.round((ss_tax + medicare_tax) * 100) / 100;

  // 6. SDI (California) — applied to GROSS pay (not reduced by Section 125)
  const sdi_tax = Math.round(grossPay * CA_SDI_RATE * 100) / 100;

  // 7. Net pay
  const net_pay =
    Math.round(
      (grossPay -
        fed_tax -
        state_tax -
        fica -
        sdi_tax -
        deductions_pretax -
        deductions_posttax) *
        100
    ) / 100;

  return {
    gross_pay: grossPay,
    fed_tax,
    state_tax,
    ss_tax,
    medicare_tax,
    sdi_tax,
    fica,
    deductions_pretax,
    deductions_posttax,
    deduction_details,
    net_pay: Math.max(0, net_pay),
  };
}
