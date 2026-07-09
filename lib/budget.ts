import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type BudgetExemption = "none" | "alcohol" | "meat";

export type BudgetItem = {
  id: string;
  event_id: string;
  name: string;
  amount_cents: number;
  exemption: BudgetExemption;
};

export type ConsumptionFlags = {
  no_alcohol: boolean;
  no_meat: boolean;
};

export type ChargeSettings = {
  event_id: string;
  base_price_cents: number;
  no_alcohol_deduction_cents: number;
  no_meat_deduction_cents: number;
};

export async function listBudgetItems(eventId: string): Promise<BudgetItem[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("budget_items")
    .select("id, event_id, name, amount_cents, exemption")
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw new Error(`Failed to list budget items: ${error.message}`);
  return (data ?? []) as BudgetItem[];
}

// Existence of a row = charging is active (specs/pix-payments.md §4).
export async function getChargeSettings(
  eventId: string
): Promise<ChargeSettings | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("event_charge_settings")
    .select(
      "event_id, base_price_cents, no_alcohol_deduction_cents, no_meat_deduction_cents"
    )
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load charge settings: ${error.message}`);
  return data as ChargeSettings | null;
}

export type BudgetShares = {
  headcount: number; // N — everyone
  drinkers: number; // Nd
  meatEaters: number; // Nm
  generalShare: number; // s_general, cents
  alcoholShare: number; // s_alcohol, cents
  meatShare: number; // s_meat, cents
  totalCents: number; // Σ all items
  // Item cost tagged to a group nobody belongs to (specs/event-budget.md §5).
  unsplitAlcohol: boolean;
  unsplitMeat: boolean;
};

// Per-group shares, rounded up so the sum collected always covers the cost
// (specs/event-budget.md §5). Pure — callers pass current participants' flags.
export function computeShares(
  items: Pick<BudgetItem, "amount_cents" | "exemption">[],
  participantFlags: ConsumptionFlags[]
): BudgetShares {
  const headcount = participantFlags.length;
  const drinkers = participantFlags.filter((f) => !f.no_alcohol).length;
  const meatEaters = participantFlags.filter((f) => !f.no_meat).length;

  const total = (exemption: BudgetExemption) =>
    items
      .filter((i) => i.exemption === exemption)
      .reduce((sum, i) => sum + i.amount_cents, 0);

  const generalTotal = total("none");
  const alcoholTotal = total("alcohol");
  const meatTotal = total("meat");

  return {
    headcount,
    drinkers,
    meatEaters,
    generalShare: headcount > 0 ? Math.ceil(generalTotal / headcount) : 0,
    alcoholShare: drinkers > 0 ? Math.ceil(alcoholTotal / drinkers) : 0,
    meatShare: meatEaters > 0 ? Math.ceil(meatTotal / meatEaters) : 0,
    totalCents: generalTotal + alcoholTotal + meatTotal,
    unsplitAlcohol: alcoholTotal > 0 && drinkers === 0,
    unsplitMeat: meatTotal > 0 && meatEaters === 0,
  };
}

// What one participant owes given their flags (specs/event-budget.md §5).
export function amountFor(
  shares: BudgetShares,
  flags: ConsumptionFlags
): number {
  return (
    shares.generalShare +
    (flags.no_alcohol ? 0 : shares.alcoholShare) +
    (flags.no_meat ? 0 : shares.meatShare)
  );
}

export { formatBRL } from "@/lib/format";
