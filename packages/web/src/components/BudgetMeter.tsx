function ratioColor(ratio: number): string {
  if (ratio >= 0.9) return "var(--danger)";
  if (ratio >= 0.7) return "var(--accent)";
  return "var(--success)";
}

function BudgetRow({ label, spent, cap }: { label: string; spent: number; cap: number }) {
  const ratio = cap > 0 ? Math.min(1, spent / cap) : 0;
  return (
    <div className="budget-meter__row">
      <span className="budget-meter__label">{label}</span>
      <span className="budget-meter__track">
        <span
          className="budget-meter__fill"
          style={{ width: `${ratio * 100}%`, background: ratioColor(ratio) }}
        />
      </span>
      <span className="budget-meter__value">
        {spent.toLocaleString()} / {cap.toLocaleString()}
      </span>
    </div>
  );
}

export function BudgetMeter({
  budget,
}: {
  budget: { spentToday: number; spentTotal: number; daily: number; initial: number };
}) {
  return (
    <div className="budget-meter">
      <BudgetRow label="Today" spent={budget.spentToday} cap={budget.daily} />
      <BudgetRow label="Total" spent={budget.spentTotal} cap={budget.initial} />
    </div>
  );
}
