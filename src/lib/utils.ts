import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}


/** Formata quantidade de estoque sem nunca mostrar "-0" (ex.: -0.0001 vira "0.00"). */
export function fmtStock(value: number, digits = 2) {
  const s = Number(value).toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}
