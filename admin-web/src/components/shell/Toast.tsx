import { useAdmin } from "@/state/AdminContext";

export function Toast() {
  const { toast } = useAdmin();
  return (
    <>
      {/* Live region stays mounted so assistive tech announces each new message. */}
      <div className="sr-only" role="status" aria-live="polite">
        {toast}
      </div>
      {toast && (
        <div className="toast" aria-hidden="true">
          <span className="toast__dot" />
          {toast}
        </div>
      )}
    </>
  );
}
