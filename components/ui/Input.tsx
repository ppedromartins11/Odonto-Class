import { type InputHTMLAttributes, forwardRef } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", error = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`h-10 w-full rounded-md border bg-input-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
        error ? "border-destructive" : "border-border"
      } ${className}`}
      {...props}
    />
  );
});
