import { type HTMLAttributes } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  success: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  danger: "bg-red-100 text-destructive",
  info: "bg-accent text-accent-foreground",
};

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

export function Badge({ className = "", tone = "neutral", ...props }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    />
  );
}
