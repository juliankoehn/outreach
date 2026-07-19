"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { AuthConsole } from "@/components/auth-console";
import { AuthField } from "@/components/auth-field";
import { Button } from "@/components/ui/button";
import { authRequest } from "@/lib/auth-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: { email?: string; password?: string } = {};
    if (!email.trim()) e.email = t("errors.emailRequired");
    else if (!EMAIL_RE.test(email)) e.email = t("errors.emailInvalid");
    if (!password) e.password = t("errors.passwordRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setLoading(true);
    const res = await authRequest("sign-in", { email, password });
    setLoading(false);
    if (res.ok) {
      router.push("/dashboard");
      return;
    }
    setFormError(t(`errors.${res.code}`));
  }

  return (
    <AuthConsole
      kicker={t("login.kicker")}
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      statement={t("login.statement")}
    >
      <form className="mt-6 grid gap-4" onSubmit={onSubmit} noValidate>
        {formError && (
          <div
            className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            role="alert"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        )}
        <AuthField
          label={t("common.email")}
          name="email"
          type="email"
          placeholder={t("login.emailPlaceholder")}
          value={email}
          autoComplete="email"
          error={errors.email}
          onChange={setEmail}
        />
        <AuthField
          label={t("common.password")}
          name="password"
          type="password"
          placeholder={t("login.passwordPlaceholder")}
          value={password}
          autoComplete="current-password"
          error={errors.password}
          onChange={setPassword}
        />
        <Button type="submit" disabled={loading} className="mt-1 w-full">
          {loading ? t("login.submitting") : t("login.submit")}
          {!loading && <ArrowRight className="size-4" />}
        </Button>
      </form>

      <p className="text-muted-foreground mt-5 text-sm">
        {t("login.switchPrompt")}{" "}
        <a href="/signup" className="text-foreground font-medium underline underline-offset-4">
          {t("login.switchAction")}
        </a>
      </p>
    </AuthConsole>
  );
}
