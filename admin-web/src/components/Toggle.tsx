import { cx } from "@/lib/css";

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  /** Accessible name — the switch itself has no visible text. */
  label: string;
  size?: "md" | "lg";
}

export function Toggle({ checked, onChange, label, size = "md" }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("toggle", size === "lg" && "toggle--lg")}
      onClick={onChange}
    >
      <span className="toggle__knob" />
    </button>
  );
}
