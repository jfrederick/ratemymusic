import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetLedger } from "../src/budget.js";
import { openDb } from "../src/db.js";

describe("BudgetLedger", () => {
  it("allows spending on a fresh ledger", () => {
    const db = openDb(":memory:");
    const ledger = new BudgetLedger(db, { daily: 50, initial: 400 }, () => "2026-07-08");
    expect(ledger.canSpend()).toBe(true);
    expect(ledger.spentToday()).toBe(0);
    expect(ledger.spentTotal()).toBe(0);
    db.close();
  });

  it("accumulates spend within a day", () => {
    const db = openDb(":memory:");
    const ledger = new BudgetLedger(db, { daily: 50, initial: 400 }, () => "2026-07-08");
    ledger.spend(2);
    ledger.spend(3);
    expect(ledger.spentToday()).toBe(5);
    expect(ledger.spentTotal()).toBe(5);
    db.close();
  });

  it("blocks once the daily cap is reached", () => {
    const db = openDb(":memory:");
    const ledger = new BudgetLedger(db, { daily: 3, initial: 400 }, () => "2026-07-08");
    ledger.spend(3);
    expect(ledger.canSpend()).toBe(false);
    expect(() => ledger.spend()).toThrow(BudgetExceededError);
    db.close();
  });

  it("resets the daily cap on rollover but keeps enforcing the lifetime cap", () => {
    const db = openDb(":memory:");
    let day = "2026-07-08";
    const ledger = new BudgetLedger(db, { daily: 3, initial: 400 }, () => day);

    ledger.spend(3);
    expect(ledger.canSpend()).toBe(false);

    day = "2026-07-09";
    expect(ledger.canSpend()).toBe(true);
    expect(ledger.spentToday()).toBe(0);
    ledger.spend(3);
    expect(ledger.spentTotal()).toBe(6);
    db.close();
  });

  it("blocks once the lifetime/initial cap is reached across days", () => {
    const db = openDb(":memory:");
    let day = "2026-07-08";
    const ledger = new BudgetLedger(db, { daily: 100, initial: 5 }, () => day);

    ledger.spend(3);
    day = "2026-07-09";
    expect(ledger.canSpend(3)).toBe(false);
    expect(() => ledger.spend(3)).toThrow(BudgetExceededError);
    ledger.spend(2);
    expect(ledger.spentTotal()).toBe(5);
    db.close();
  });

  it("sums spentTotal across multiple days", () => {
    const db = openDb(":memory:");
    let day = "2026-07-08";
    const ledger = new BudgetLedger(db, { daily: 100, initial: 400 }, () => day);
    ledger.spend(5);
    day = "2026-07-09";
    ledger.spend(7);
    day = "2026-07-10";
    ledger.spend(2);
    expect(ledger.spentTotal()).toBe(14);
    expect(ledger.spentToday()).toBe(2);
    db.close();
  });

  it("uses a default today() implementation returning a YYYY-MM-DD local date when none is injected", () => {
    const db = openDb(":memory:");
    const ledger = new BudgetLedger(db, { daily: 50, initial: 400 });
    ledger.spend(1);
    expect(ledger.spentToday()).toBe(1);
    db.close();
  });
});
