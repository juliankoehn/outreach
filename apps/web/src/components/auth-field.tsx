"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  placeholder?: string;
  value: string;
  autoComplete?: string;
  error?: string;
  onChange: (value: string) => void;
}

export function AuthField({
  label, name, type = "text", placeholder, value, autoComplete, error, onChange,
}: Props) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={isPassword && reveal ? "text" : type}
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(isPassword && "pr-9")}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide password" : "Show password"}
            aria-pressed={reveal}
            className="text-muted-foreground hover:text-foreground absolute top-0 right-0 grid h-9 w-9 place-items-center"
          >
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-destructive text-xs" role="alert">{error}</p>}
    </div>
  );
}
