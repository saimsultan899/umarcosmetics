import { getCachedRows, listPendingMutations } from "@/lib/offline/local-db";

export type CashLine = {
  line_date: string;
  sort_at: string | null;
  source: string;
  direction: "in" | "out";
  amount: number;
  title: string;
  sector: string | null;
  code: string | null;
  ref_id: string | null;
  movement_id: string | null;
  pair_id: string | null;
};

export type CashLender = {
  id: string;
  name: string;
  phone: string | null;
  is_active: boolean;
  outstanding: number;
};

export type CashSister = {
  id: string;
  name: string;
  on_hand: number;
  borrowed: number;
};

export type CashDesk = {
  on_hand: number;
  brought_forward: number;
  as_of: string;
  from: string;
  is_hub: boolean;
  lines: CashLine[];
  lenders: CashLender[];
  sisters: CashSister[];
  offline: boolean;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function day(value: unknown) {
  return String(value || "").slice(0, 10);
}

function partyRecord(row: Record<string, unknown>) {
  const parties = row.parties;
  if (parties && typeof parties === "object" && !Array.isArray(parties)) {
    return parties as { name_en?: string; route?: string; party_code?: string };
  }
  return null;
}

function partyName(row: Record<string, unknown>) {
  const name = partyRecord(row)?.name_en;
  return name ? String(name) : "";
}

function partySector(row: Record<string, unknown>) {
  const route = partyRecord(row)?.route;
  const sector = route ? String(route).trim() : "";
  return sector || null;
}

function partyCode(row: Record<string, unknown>) {
  const code = partyRecord(row)?.party_code;
  const value = code ? String(code).trim() : "";
  return value || null;
}

type Move = {
  id: string;
  movement_date: string;
  kind: string;
  direction: "in" | "out";
  amount: number;
  lender_id: string | null;
  counterparty_company_id: string | null;
  pair_id: string | null;
  remarks: string | null;
  created_at: string;
};

export async function buildLocalCashDesk(
  companyId: string,
  from: string,
  asOf: string,
): Promise<CashDesk> {
  const [sales, vouchers, expenses, movementRows, lenderRows, pending] =
    await Promise.all([
      getCachedRows("sale_invoices", companyId),
      getCachedRows("vouchers", companyId),
      getCachedRows("expenses", companyId),
      getCachedRows("cash_movements", companyId).catch(() => []),
      getCachedRows("cash_lenders", companyId).catch(() => []),
      listPendingMutations(companyId),
    ]);

  const lenders = new Map<string, { name: string; phone: string | null; is_active: boolean }>();
  for (const row of lenderRows) {
    lenders.set(String(row.id), {
      name: String(row.name || "Person"),
      phone: row.phone ? String(row.phone) : null,
      is_active: row.is_active !== false,
    });
  }

  const moves = new Map<string, Move>();
  for (const row of movementRows) {
    if (row._syncStatus === "pending") continue;
    moves.set(String(row.id), {
      id: String(row.id),
      movement_date: day(row.movement_date),
      kind: String(row.kind || ""),
      direction: row.direction === "out" ? "out" : "in",
      amount: num(row.amount),
      lender_id: row.lender_id ? String(row.lender_id) : null,
      counterparty_company_id: row.counterparty_company_id
        ? String(row.counterparty_company_id)
        : null,
      pair_id: row.pair_id ? String(row.pair_id) : null,
      remarks: row.remarks ? String(row.remarks) : null,
      created_at: String(row.created_at || ""),
    });
  }

  for (const mutation of pending) {
    const payload = mutation.payload || {};
    if (mutation.type === "cash_lender") {
      const id = String(payload.id || mutation.localId || mutation.id);
      lenders.set(id, {
        name: String(payload.name || "Person"),
        phone: payload.phone ? String(payload.phone) : null,
        is_active: payload.is_active !== false,
      });
    } else if (mutation.type === "cash_opening") {
      const amount = num(payload.amount);
      const existing = [...moves.values()].find((m) => m.kind === "opening");
      if (existing) moves.delete(existing.id);
      if (amount > 0) {
        moves.set(mutation.id, {
          id: mutation.id,
          movement_date: day(payload.movement_date) || asOf,
          kind: "opening",
          direction: "in",
          amount,
          lender_id: null,
          counterparty_company_id: null,
          pair_id: null,
          remarks: payload.remarks ? String(payload.remarks) : null,
          created_at: mutation.createdAt,
        });
      }
    } else if (mutation.type === "person_cash") {
      const kind = String(payload.kind || "");
      moves.set(mutation.id, {
        id: mutation.id,
        movement_date: day(payload.movement_date) || asOf,
        kind,
        direction: kind === "person_repay" ? "out" : "in",
        amount: num(payload.amount),
        lender_id: payload.lender_id ? String(payload.lender_id) : null,
        counterparty_company_id: null,
        pair_id: null,
        remarks: payload.remarks ? String(payload.remarks) : null,
        created_at: mutation.createdAt,
      });
    } else if (mutation.type === "cash_movement_delete") {
      const id = String(payload.id || "");
      if (id) moves.delete(id);
    }
  }

  const events: CashLine[] = [];

  for (const row of sales) {
    const status = String(row.status || "posted").toLowerCase();
    if (status === "cancelled") continue;
    const amount = num(row.amount_paid);
    const date = day(row.invoice_date);
    if (!(amount > 0) || !date || date > asOf) continue;
    const name = partyName(row);
    events.push({
      line_date: date,
      sort_at: String(row.created_at || ""),
      source: "sale",
      direction: "in",
      amount,
      title: [row.invoice_no, name].filter(Boolean).join(" — ") || "Paid sale",
      sector: partySector(row),
      code: partyCode(row),
      ref_id: row.id ? String(row.id) : null,
      movement_id: null,
      pair_id: null,
    });
  }

  for (const row of vouchers) {
    const status = String(row.status || "posted").toLowerCase();
    if (status === "cancelled") continue;
    const type = String(row.voucher_type || "").toUpperCase();
    const date = day(row.voucher_date || row.created_at);
    if (!date || date > asOf) continue;
    const lines = Array.isArray(row.voucher_lines)
      ? (row.voucher_lines as Array<Record<string, unknown>>)
      : [];
    if (type === "CR" || type === "RECOVERY" || type === "CASH_RECEIPT") {
      if (lines.length) {
        for (const line of lines) {
          const amount = num(line.amount);
          if (!(amount > 0)) continue;
          events.push({
            line_date: date,
            sort_at: String(row.created_at || ""),
            source: "cash_receipt",
            direction: "in",
            amount,
            title: partyName(line) || String(row.narration || row.voucher_no || "Cash receipt"),
            sector: partySector(line),
            code: partyCode(line),
            ref_id: row.id ? String(row.id) : null,
            movement_id: null,
            pair_id: null,
          });
        }
      } else {
        const amount = num(row.total_amount ?? row.amount);
        if (amount > 0) {
          events.push({
            line_date: date,
            sort_at: String(row.created_at || ""),
            source: "cash_receipt",
            direction: "in",
            amount,
            title: String(row.narration || row.voucher_no || "Cash receipt"),
            sector: null,
            code: null,
            ref_id: row.id ? String(row.id) : null,
            movement_id: null,
            pair_id: null,
          });
        }
      }
    } else if (type === "CP" || type === "CASH_PAYMENT") {
      const method = String(row.payment_method || "cash");
      if (method !== "cash") continue;
      const amount =
        num(row.total_amount) ||
        lines.reduce((sum, line) => sum + num(line.amount), 0);
      if (!(amount > 0)) continue;
      events.push({
        line_date: date,
        sort_at: String(row.created_at || ""),
        source: "cash_payment",
        direction: "out",
        amount,
        title: String(row.narration || row.voucher_no || "Cash payment"),
        sector: null,
        code: null,
        ref_id: row.id ? String(row.id) : null,
        movement_id: null,
        pair_id: null,
      });
    }
  }

  for (const row of expenses) {
    const amount = num(row.amount);
    const date = day(row.expense_date || row.doc_date);
    if (!(amount > 0) || !date || date > asOf) continue;
    events.push({
      line_date: date,
      sort_at: String(row.created_at || ""),
      source: "expense",
      direction: "out",
      amount,
      title: String(row.category || row.remarks || "Expense"),
      sector: null,
      code: null,
      ref_id: row.id ? String(row.id) : null,
      movement_id: null,
      pair_id: null,
    });
  }

  for (const move of moves.values()) {
    if (!move.movement_date || move.movement_date > asOf || !(move.amount > 0)) continue;
    const person = move.lender_id ? lenders.get(move.lender_id)?.name : "";
    let title = "Cash";
    if (move.kind === "opening") title = "Opening cash";
    else if (move.kind === "person_borrow") title = `Borrowed from ${person || "a person"}`;
    else if (move.kind === "person_repay") title = `Returned to ${person || "a person"}`;
    else if (move.kind === "company_borrow")
      title = move.direction === "in" ? "Borrowed from a company" : "Lent to a company";
    else if (move.kind === "company_repay")
      title = move.direction === "out" ? "Returned to a company" : "Received back from a company";
    events.push({
      line_date: move.movement_date,
      sort_at: move.created_at,
      source: move.kind,
      direction: move.direction,
      amount: move.amount,
      title,
      sector: null,
      code: null,
      ref_id: move.id,
      movement_id: move.id,
      pair_id: move.pair_id,
    });
  }

  events.sort((a, b) =>
    a.line_date === b.line_date
      ? String(a.sort_at || "").localeCompare(String(b.sort_at || ""))
      : a.line_date.localeCompare(b.line_date),
  );

  let brought = 0;
  let onHand = 0;
  const lines: CashLine[] = [];
  for (const event of events) {
    const signed = event.direction === "in" ? event.amount : -event.amount;
    onHand += signed;
    if (event.line_date < from) brought += signed;
    else lines.push(event);
  }

  const lenderList: CashLender[] = [];
  for (const [id, lender] of lenders) {
    let outstanding = 0;
    for (const move of moves.values()) {
      if (move.lender_id !== id || move.movement_date > asOf) continue;
      if (move.kind === "person_borrow") outstanding += move.amount;
      if (move.kind === "person_repay") outstanding -= move.amount;
    }
    if (lender.is_active || Math.abs(outstanding) > 0.005) {
      lenderList.push({
        id,
        name: lender.name,
        phone: lender.phone,
        is_active: lender.is_active,
        outstanding,
      });
    }
  }
  lenderList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    on_hand: onHand,
    brought_forward: brought,
    as_of: asOf,
    from,
    is_hub: false,
    lines,
    lenders: lenderList,
    sisters: [],
    offline: true,
  };
}
