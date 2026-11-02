import { Dashboard } from "./dashboard.tsx";
import { useLanguage } from "./language.ts";
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import * as api from "./api.ts";
import {
  fields,
  labels,
  types,
  chileToday,
  status,
  validate,
  businessDates,
  uniqueAbsenceDays,
  assertExportRange,
  type Data,
  type RecordRow,
  type Calendar,
  type Profile,
  type EventRow,
} from "./model.ts";
import { buildXlsx } from "./xlsx.ts";
import {
  readPreferences,
  applyPreferences,
  savePreferences,
  defaultPreferences,
  type Preferences,
} from "./preferences.ts";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./styles.css";
import "./independent.css";
import "./accessibility.css";

const emptyCalendar: Calendar = { years: [], holidays: [] };
const date = (v: unknown) =>
  String(v ?? "")
    .split("-")
    .reverse()
    .join("/");
const stamp = (s: string) =>
  new Date(s).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    dateStyle: "short",
    timeStyle: "short",
  });
const msg = (e: unknown) =>
  e instanceof Error ? e.message : "No se pudo completar la operación.";
const primary = "jcontreras@saludparral.cl";
const blank = (): Data =>
  ({
    ...Object.fromEntries(fields.map((f) => [f, ""])),
    Fecha_Inicio: chileToday(),
    Fecha_Termino: chileToday(),
    Tipo_Horario: "NO INFORMADO",
    Dias_Bloqueo: 0,
  }) as Data;
function Logo() {
  return (
    <a href="/" className="brand">
      <span className="brandmark">▦</span>
      <span>Registro de bloqueos</span>
    </a>
  );
}
function App() {
  useEffect(() => {
    applyPreferences(readPreferences());
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!api.configured);
  const [preview, setPreview] = useState(
    import.meta.env.DEV && location.pathname === "/vista-diseno",
  );
  const [recovering, setRecovering] = useState(
    location.pathname === "/recuperar",
  );
  useEffect(() => {
    if (!api.supabase) return;
    let alive = true;
    void api.supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session);
        setReady(true);
      }
    });
    const { data } = api.supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setReady(true);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <div className="auth-page">
        <p>Comprobando sesión…</p>
      </div>
    );
  if (!api.configured && !preview)
    return (
      <div className="auth-page">
        <section className="auth-card">
          <Logo />
          <span className="eyebrow">VERSIÓN INDEPENDIENTE · 1.1</span>
          <h1>Tu registro, con acceso propio.</h1>
          <p>
            El código está preparado para una cuenta de Supabase de la unidad.
            Falta configurar el proyecto y publicar esta versión en un
            alojamiento propio.
          </p>
          <ol>
            <li>Crear el proyecto de base de datos y autenticación.</li>
            <li>
              Aplicar los dos archivos de la carpeta <code>database</code>.
            </li>
            <li>
              Configurar la URL y clave publicable desde{" "}
              <code>.env.example</code>.
            </li>
            <li>
              Publicar <code>dist</code> y configurar el dominio del acceso.
            </li>
          </ol>
          <p className="muted">
            El acceso inicial avanzado está reservado a {primary}. Este paquete
            no depende de ChatGPT ni contiene datos del Excel.
          </p>
          {import.meta.env.DEV && (
            <button className="button primary" onClick={() => setPreview(true)}>
              Ver interfaz local sin conexión
            </button>
          )}
          <p className="muted">
            Consulta README.md para la instalación. No introduzcas contraseñas
            ni claves privadas en el código.
          </p>
        </section>
      </div>
    );
  if (recovering || (!session && !preview))
    return (
      <Auth
        recovery={recovering}
        onDone={() => {
          setRecovering(false);
          history.replaceState(null, "", "/");
        }}
      />
    );
  return (
    <Dashboard
      key={session?.user.id || "preview"}
      preview={preview}
      session={session}
      onExitPreview={() => setPreview(false)}
    />
  );
}

function Auth({ recovery, onDone }: { recovery: boolean; onDone: () => void }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState(recovery ? "update" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (recovery) setMode("update");
  }, [recovery]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const c = api.supabase!;
      if ((mode === "signup" || mode === "update") && password !== password2)
        throw new Error("Las contraseñas no coinciden.");
      const normalized = email.trim().toLowerCase();
      const result =
        mode === "login"
          ? await c.auth.signInWithPassword({ email: normalized, password })
          : mode === "signup"
            ? await c.auth.signUp({
                email: normalized,
                password,
                options: { emailRedirectTo: location.origin + "/" },
              })
            : mode === "forgot"
              ? await c.auth.resetPasswordForEmail(normalized, {
                  redirectTo: location.origin + "/recuperar",
                })
              : await c.auth.updateUser({ password });
      if (result.error) throw new Error(result.error.message);
      setPassword("");
      setPassword2("");
      if (mode === "signup")
        setNotice(
          "Si el registro fue aceptado, revisa tu correo para confirmar la cuenta. La administración debe haber habilitado ese mismo correo.",
        );
      if (mode === "forgot")
        setNotice(
          "Si existe una cuenta para ese correo, recibirás las instrucciones de recuperación.",
        );
      if (mode === "update") {
        setNotice("Contraseña actualizada.");
        onDone();
      }
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-card">
        <Logo />
        <p className="eyebrow">
          {t(
            "REGISTRO COMPARTIDO · ACCESO PRIVADO",
            "SHARED REGISTRY · PRIVATE ACCESS",
          )}
        </p>
        <h1>
          {mode === "login"
            ? t("Bienvenido a tu registro", "Welcome to your registry")
            : mode === "signup"
              ? t("Activa tu acceso", "Activate your access")
              : mode === "forgot"
                ? t("Recupera tu contraseña", "Recover your password")
                : t("Define tu nueva contraseña", "Set your new password")}
        </h1>
        <p>
          {t(
            "Ingresa con la cuenta autorizada por la administración.",
            "Sign in with the account authorized by the administrator.",
          )}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode !== "update" && (
            <label className="form-field">
              <span>{t("Correo", "Email")}</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label className="form-field">
              <span>{t("Contraseña", "Password")}</span>
              <input
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small>
                {mode !== "login"
                  ? t("Al menos 12 caracteres.", "At least 12 characters.")
                  : ""}
              </small>
            </label>
          )}
          {(mode === "signup" || mode === "update") && (
            <label className="form-field">
              <span>{t("Repite la contraseña", "Repeat password")}</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? t("Procesando…", "Processing…")
              : mode === "login"
                ? t("Entrar al registro", "Sign in")
                : mode === "signup"
                  ? t("Crear mi cuenta", "Create my account")
                  : mode === "forgot"
                    ? t("Enviar recuperación", "Send recovery email")
                    : t("Guardar contraseña", "Save password")}
          </button>
        </form>
        {mode !== "update" && (
          <div className="auth-links">
            {mode !== "login" && (
              <button
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                {t("Ya tengo cuenta", "I already have an account")}
              </button>
            )}
            {mode !== "signup" && (
              <button
                onClick={() => {
                  setMode("signup");
                  setError("");
                  setNotice("");
                }}
              >
                {t(
                  "Primera vez: crear contraseña",
                  "First time: create password",
                )}
              </button>
            )}
            {mode !== "forgot" && (
              <button
                onClick={() => {
                  setMode("forgot");
                  setError("");
                  setNotice("");
                }}
              >
                {t("Olvidé mi contraseña", "Forgot my password")}
              </button>
            )}
          </div>
        )}
        <p className="muted">
          {t(
            "Usa tu cuenta personal para que el historial distinga tu trabajo.",
            "Use your personal account so the history identifies your work.",
          )}
        </p>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import './institutional.css';
