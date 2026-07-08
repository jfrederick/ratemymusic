export function Skeleton({ width = "100%", height = "1em" }: { width?: string; height?: string }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}
