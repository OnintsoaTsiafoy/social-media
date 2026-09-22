import { useState, type FormEvent } from "react";

import { toUserMessage } from "@/api/errors";
import { ApiError } from "@/api/transport";
import { BrandMark } from "@/components/BrandMark";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { PRODUCT_NAME } from "@/config";
import { useI18n } from "@/i18n";
import { cx } from "@/lib/css";
import { useAuth } from "@/state/AuthContext";

import "./login.css";

export function LoginScreen() {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (failure) {
      // 403 sur /admin/session : identifiants valides, mais compte sans rôle d'administrateur.
      setError(failure instanceof ApiError && failure.code === "forbidden" ? t("login.notAdmin") : toUserMessage(failure, t));
      setPending(false);
    }
  };

  return (
    <main className="login">
      <div className="login__lang">
        <ThemeSwitch />
        <LocaleSwitch />
      </div>
      <form className="login__card" onSubmit={submit}>
        <div className="brand login__brand">
          <BrandMark />
          <div>
            <div className="brand__name login__name">{PRODUCT_NAME}</div>
            <div className="brand__tag login__tag">{t("brand.tag")}</div>
          </div>
        </div>

        <h1 className="login__title">{t("login.title")}</h1>
        <p className="login__subtitle">{t("login.subtitle")}</p>

        <label className="login__field">
          <span>{t("login.email")}</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="login__field">
          <span>{t("login.password")}</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && (
          <div className="login__error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className={cx("btn", "btn--primary", "login__submit")} disabled={pending}>
          {pending ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
    </main>
  );
}

/** Écran neutre pendant la reprise d'une session déjà ouverte dans l'onglet. */
export function RestoringScreen() {
  const { t } = useI18n();
  return (
    <main className="login">
      <div className="login__restoring" role="status" aria-busy="true">
        {t("login.restoring")}
      </div>
    </main>
  );
}
