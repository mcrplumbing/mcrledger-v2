import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
/** Round a number to 2 decimal places using integer math to avoid IEEE 754 drift. */
export const roundMoney = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse a string (possibly with $ and commas) to a rounded dollar amount. Returns 0 for invalid input. */
export const parseMoney = (v: string | number | null | undefined): number =>
  roundMoney(parseFloat(String(v ?? 0).replace(/[$,]/g, "")) || 0);

/** Sum an array of numbers with per-step rounding to prevent accumulation drift. */
export const sumMoney = (values: number[]): number =>
  roundMoney(values.reduce((s, v) => s + v, 0));

/** Format a dollar amount for display: $1,234.56 (always 2 decimals, absolute value). */
export const fmt = (n: number): string =>
  `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
