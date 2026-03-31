import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
// src/lib/money.ts
export const toCents = (amount: number | string): number => 
  Math.round(parseFloat(String(amount || 0)) * 100);

export const fromCents = (cents: number): number => cents / 100;

export const fmtMoney = (amount: number): string => 
  `$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
