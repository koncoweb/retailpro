import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-md bg-surface px-3.5 text-[15px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)] outline-none transition-[box-shadow] duration-150 placeholder:text-subtle focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full rounded-md bg-surface px-3.5 py-3 text-[15px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)] outline-none transition-[box-shadow] duration-150 placeholder:text-subtle focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
