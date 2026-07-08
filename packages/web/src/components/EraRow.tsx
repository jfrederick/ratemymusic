export function EraRow({ eras }: { eras: Record<string, number> }) {
  const entries = Object.entries(eras).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    return <p className="empty-state">No era data yet.</p>;
  }

  const max = Math.max(...entries.map(([, weight]) => weight)) || 1;

  return (
    <div className="era-row">
      {entries.map(([era, weight]) => (
        <div className="era-bar" key={era}>
          <span
            className="era-bar__fill"
            style={{ height: `${Math.max(3, (weight / max) * 100)}%` }}
            title={`${era}: ${weight.toFixed(2)}`}
          />
          <span className="era-bar__label">{era}</span>
        </div>
      ))}
    </div>
  );
}
