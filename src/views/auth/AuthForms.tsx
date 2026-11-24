"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/api/hooks";
import * as api from "@/lib/api-helpers/client";
import { AuthCard, Notice, Field, linkCls } from "./AuthForms.parts/SignInForm";
export { SignInForm } from "./AuthForms.parts/SignInForm";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.signUp({ body: { name: name.trim() || undefined, email, password } });
      setSentTo(email);
    } catch (err) {
      setError(apiErrorMessage(err, "We could not create your account. Please try again."));
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <AuthCard title="Check your email" subtitle={`We sent a confirmation link to ${sentTo}.`}
        footer={<Link href="/sign-in" className={linkCls}>Back to sign in</Link>}>
        <p className="text-center text-sm text-[color:var(--pl-ink-2)]">
          Open it to confirm your address, then sign in. It can take a minute to arrive — check spam too.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start tracking real profit in 2 minutes"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className={linkCls}>
            Sign in
          </Link>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {googleEnabled && (
        <>
          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => signIn("google", { callbackUrl: "/dashboard" })}>
            Continue with Google
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-[color:var(--pl-ink-2)]">
            <span className="h-px flex-1 bg-[color:var(--pl-recessed)]" />
            or
            <span className="h-px flex-1 bg-[color:var(--pl-recessed)]" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field id="name" label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field id="password" label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.requestPasswordReset({ body: { email } });
      setSent(true);
    } catch (err) {
      setError(apiErrorMessage(err, "We could not send the email. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={sent ? undefined : "We'll email you a link to choose a new one."}
      footer={<Link href="/sign-in" className={linkCls}>Back to sign in</Link>}
    >
      {sent ? (
        <Notice tone="ok">If {email} has an account, a reset link is on its way.</Notice>
      ) : (
        <>
          {error && <Notice tone="error">{error}</Notice>}
          <form onSubmit={submit} className="space-y-4">
            <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Send reset link
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}

let recoveryToken: string | null | undefined;

/** Read once, then wiped from the address bar so it is not left in history. */
function readRecoveryToken(): string | null {
  if (recoveryToken === undefined) {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    recoveryToken = hash.get("type") === "recovery" && accessToken ? accessToken : null;
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }
  return recoveryToken;
}
const noSubscribe = () => () => {};

/**
 * The page the emailed reset link opens. Supabase puts the recovery token in
 * the URL fragment, which never reaches a server log; it is read here, sent
 * once with the new password, and wiped from the address bar.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  // undefined while server-rendering: the fragment only exists in the browser.
  const token = useSyncExternalStore(noSubscribe, readRecoveryToken, () => undefined);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.resetPassword({ body: { accessToken: token, password } });
      router.replace("/sign-in?reset=1");
    } catch (err) {
      setError(apiErrorMessage(err, "We could not change your password. Please try again."));
      setPending(false);
    }
  }

  if (token === undefined) return null;

  if (token === null) {
    return (
      <AuthCard title="This link has expired" footer={<Link href="/sign-in" className={linkCls}>Back to sign in</Link>}>
        <p className="text-center text-sm text-[color:var(--pl-ink-2)]">
          Reset links work once and only for a short while.{" "}
          <Link href="/forgot-password" className={linkCls}>Ask for a new one</Link>.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} className="space-y-4">
        <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}
