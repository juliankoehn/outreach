"use client";

import { useId, useState } from "react";

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
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && revealed ? "text" : type;

  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="field__box">
        <span className="field__prompt" aria-hidden="true">&gt;</span>
        <input
          id={id}
          name={name}
          className="field__input"
          type={inputType}
          placeholder={placeholder}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            className="field__reveal"
            aria-pressed={revealed}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? "hide" : "show"}
          </button>
        )}
      </div>
      {error && <span className="field__error" role="alert">{error}</span>}
    </div>
  );
}
