import { columns } from "@/lib/css";

/** Placeholder shown for a beat while a screen "loads" (kpi row + two charts). */
export function ScreenSkeleton() {
  return (
    <div className="skeleton-screen" role="status" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 34, width: 290 }} />
      <div className="grid-auto" style={columns(215)}>
        {[0, 80, 160, 240].map((ms) => (
          <div
            key={ms}
            className="skeleton skeleton--card"
            style={{ height: 148, borderRadius: 16, animationDelay: `${ms}ms` }}
          />
        ))}
      </div>
      <div className="grid-auto" style={columns(320)}>
        <div
          className="span-2 skeleton skeleton--card"
          style={{ height: 300, borderRadius: 18, backgroundSize: "900px 100%", animationDuration: "1.5s" }}
        />
        <div
          className="skeleton skeleton--card"
          style={{ height: 300, borderRadius: 18, animationDuration: "1.5s", animationDelay: "150ms" }}
        />
      </div>
    </div>
  );
}
