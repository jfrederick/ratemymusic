export function WeightedBars({
  weights,
  limit = 12,
}: {
  weights: Record<string, number>;
  limit?: number;
}) {
  const entries = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  if (entries.length === 0) {
    return <p className="empty-state">No data yet.</p>;
  }

  const max = entries[0][1] || 1;

  return (
    <div className="weighted-bars">
      {entries.map(([name, weight]) => (
        <div className="weighted-bar" key={name}>
          <span className="weighted-bar__label" title={name}>
            {name}
          </span>
          <span className="weighted-bar__track">
            <span
              className="weighted-bar__fill"
              style={{ width: `${Math.max(4, (weight / max) * 100)}%` }}
            />
          </span>
          <span className="weighted-bar__value">{weight.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
