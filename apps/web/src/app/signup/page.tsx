"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthConsole } from "@/components/auth-console";
import { AuthField } from "@/components/auth-field";
import { authRequest } from "@/lib/auth-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export default function SignupPage() {
  const t = useTranslations();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: typeof errors = {};
    if (!name.trim()) e.name = t("errors.nameRequired");
    if (!email.trim()) e.email = t("errors.emailRequired");
    else if (!EMAIL_RE.test(email)) e.email = t("errors.emailInvalid");
    if (!password) e.password = t("errors.passwordRequired");
    else if (password.length < MIN_PASSWORD) e.password = t("errors.passwordShort");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setLoading(true);
    const res = await authRequest("sign-up", { name, email, password });
    setLoading(false);
    if (res.ok) {
      router.push("/accounts");
      return;
    }
    setFormError(t(`errors.${res.code}`));
  }

  return (
    <AuthConsole
      kicker={t("signup.kicker")}
      title={t("signup.title")}
      subtitle={t("signup.subtitle")}
      statement={t("signup.statement")}
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        {formError && (
          <div className="alert" role="alert">
            <span className="alert__tick" aria-hidden="true">!</span>
            {formError}
          </div>
        )}
        <AuthField
          label={t("common.name")}
          name="name"
          type="text"
          placeholder={t("signup.namePlaceholder")}
          value={name}
          autoComplete="name"
          error={errors.name}
          onChange={setName}
        />
        <AuthField
          label={t("common.email")}
          name="email"
          type="email"
          placeholder={t("signup.emailPlaceholder")}
          value={email}
          autoComplete="email"
          error={errors.email}
          onChange={setEmail}
        />
        <AuthField
          label={t("common.password")}
          name="password"
          type="password"
          placeholder={t("signup.passwordPlaceholder")}
          value={password}
          autoComplete="new-password"
          error={errors.password}
          onChange={setPassword}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? (
            t("signup.submitting")
          ) : (
            <>
              {t("signup.submit")}
              <span className="btn__arrow" aria-hidden="true">→</span>
            </>
          )}
        </button>
      </form>

      <p className="switch">
        {t("signup.switchPrompt")} <a href="/login">{t("signup.switchAction")} ↗</a>
      </p>
    </AuthConsole>
  );
}
