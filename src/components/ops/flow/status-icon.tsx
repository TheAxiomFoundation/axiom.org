import { AlertTriangle, CheckCircle2, CircleDot, OctagonAlert } from "lucide-react";
import type { Status } from "./flow-layout";

export const STATUS_LABEL: Record<Status, string> = {
  good: "On target",
  warning: "Off target",
  critical: "Alert",
  neutral: "No target",
};

export function StatusIcon({ status, size = 12 }: { status: Status; size?: number }) {
  if (status === "critical") return <OctagonAlert size={size} aria-hidden />;
  if (status === "warning") return <AlertTriangle size={size} aria-hidden />;
  if (status === "good") return <CheckCircle2 size={size} aria-hidden />;
  return <CircleDot size={size} aria-hidden />;
}
