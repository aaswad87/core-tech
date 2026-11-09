import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const controlClass =
  "w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:opacity-50 md:text-sm";

type FieldIds = { id: string; describedBy?: string };

function fieldIds(name: string, hint?: string, error?: string): FieldIds & { hintId: string; errorId: string } {
  const id = `field-${name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return { id, describedBy, hintId, errorId };
}

type ShellProps = {
  name: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (ids: FieldIds) => React.ReactNode;
};

/** Label, hint and error wiring shared by every form control. */
export function FieldShell({ name, label, required, hint, error, children }: ShellProps) {
  const { id, describedBy, hintId, errorId } = fieldIds(name, hint, error);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {!required && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

type Common = { name: string; label: string; hint?: string; error?: string; required?: boolean };

export function InputField({
  name,
  label,
  hint,
  error,
  required,
  className,
  ...props
}: Common & Omit<React.ComponentProps<"input">, "id" | "name">) {
  return (
    <FieldShell name={name} label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <input
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, "h-10", className)}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export function TextareaField({
  name,
  label,
  hint,
  error,
  required,
  className,
  ...props
}: Common & Omit<React.ComponentProps<"textarea">, "id" | "name">) {
  return (
    <FieldShell name={name} label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, "min-h-32 py-2", className)}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  name,
  label,
  hint,
  error,
  required,
  options,
  placeholder = "Choose…",
  className,
  ...props
}: Common & {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
} & Omit<React.ComponentProps<"select">, "id" | "name">) {
  return (
    <FieldShell name={name} label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <select
          id={id}
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass, "h-10", className)}
          {...props}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function CheckboxField({
  name,
  error,
  children,
  ...props
}: { name: string; error?: string; children: React.ReactNode } & Omit<React.ComponentProps<"input">, "id" | "name" | "type">) {
  const { id, errorId } = fieldIds(name, undefined, error);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-0.5 size-4 shrink-0 accent-brand"
          {...props}
        />
        <label htmlFor={id} className="text-sm leading-snug text-foreground">
          {children}
        </label>
      </div>
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
