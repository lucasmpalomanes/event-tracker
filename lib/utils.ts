import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// "2026-11-21" → "21/11/2026"
export function formatDay(day: string) {
  const [y, m, d] = day.split("-")
  return `${d}/${m}/${y}`
}
