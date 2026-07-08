import type { DatabaseType } from "./db.js";

export class BudgetExceededError extends Error {}

function defaultToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class BudgetLedger {
  private readonly db: DatabaseType;
  private readonly daily: number;
  private readonly initial: number;
  private readonly today: () => string;

  constructor(
    db: DatabaseType,
    opts: { daily: number; initial: number },
    today: () => string = defaultToday,
  ) {
    this.db = db;
    this.daily = opts.daily;
    this.initial = opts.initial;
    this.today = today;
  }

  spentToday(): number {
    const row = this.db
      .prepare("SELECT credits_spent FROM budget_ledger WHERE day = ?")
      .get(this.today()) as { credits_spent: number } | undefined;
    return row?.credits_spent ?? 0;
  }

  spentTotal(): number {
    const row = this.db.prepare("SELECT SUM(credits_spent) AS total FROM budget_ledger").get() as {
      total: number | null;
    };
    return row.total ?? 0;
  }

  canSpend(n = 1): boolean {
    return this.spentToday() + n <= this.daily && this.spentTotal() + n <= this.initial;
  }

  spend(n = 1): void {
    if (!this.canSpend(n)) {
      throw new BudgetExceededError(
        `Budget exceeded: cannot spend ${n} (spentToday=${this.spentToday()}, daily=${this.daily}, spentTotal=${this.spentTotal()}, initial=${this.initial})`,
      );
    }
    this.db
      .prepare(
        "INSERT INTO budget_ledger (day, credits_spent) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET credits_spent = credits_spent + excluded.credits_spent",
      )
      .run(this.today(), n);
  }
}
