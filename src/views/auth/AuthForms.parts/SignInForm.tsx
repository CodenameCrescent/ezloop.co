"use client";

import { type ReactNode, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Sign in, sign up, forgot and reset password. Signing in goes through
 * NextAuth (`signIn("credentials" | "google")`); the other three call our own
 * `/api/auth/*` routes, which talk to Supabase. The browser never holds a
 * Supabase key.
 */

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[color:var(--pl-bg)] px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mx-auto mb-6 flex w-fit items-center gap-2" aria-label="Profit Loop home">
          <img src="/logo.svg" alt="" className="h-10 w-10 rounded-xl" />
        </Link>
        <div className="rounded-xl bg-[color:var(--pl-surface)] p-6 sm:p-8">
          <h1 className="t-title text-center text-[color:var(--pl-ink)]">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-sm text-[color:var(--pl-ink-2)]">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <p className="mt-4 text-center text-sm text-[color:var(--pl-ink-2)]">{footer}</p>}
      </div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  const cls =
    tone === "error"
      ? "bg-[color:var(--pl-red-tint)] text-[color:var(--pl-red)]"
      : "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-ink)]";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg px-3 py-2 text-sm ${cls}`}>
      {children}
    </p>
  );
}

export function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

export const linkCls = "font-medium text-[color:var(--pl-orange-text)] hover:underline";

/** What NextAuth's `?error=` codes mean to an owner. */
export function signInErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code.startsWith("RATE_LIMITED")) {
    const minutes = Number(code.split(":")[1]) || 15;
    return `Too many sign-in attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again — or reset your password.`;
  }
  if (code === "SIGNIN_UNAVAILABLE") return "We couldn't reach the sign-in service just now. Please try again in a moment.";
  if (code === "OAUTH_ACCOUNT_UNCONFIRMED")
    return "An account with this email is waiting for its email to be confirmed. Confirm it from the email we sent — or reset its password — then try again.";
  if (code === "OAUTH_EMAIL_UNVERIFIED") return "Your Google account's email isn't verified, so we can't sign you in with it.";
  if (code === "OAUTH_ACCOUNT_UNAVAILABLE") return "We can't sign you in with Google for this email. Please sign in with your password.";
  if (code === "EMAIL_NOT_VERIFIED") return "Please confirm your email first — check your inbox for the link.";
  if (code === "CredentialsSignin") return "That email and password don't match.";
  if (code === "AccessDenied" || code === "OAuthSignin" || code === "OAuthCallback")
    return "That sign-in didn't go through. Please try again.";
  return "Something went wrong signing you in. Please try again.";
}

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() => signInErrorMessage(search.get("error")));
  const verified = search.get("verified") === "1";
  const reset = search.get("reset") === "1";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.ok && !result.error) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }
    setPending(false);
    setError(signInErrorMessage(result?.error ?? "CredentialsSignin"));
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your Profit Loop workspace"
      footer={
        <>
          New here?{" "}
          <Link href="/sign-up" className={linkCls}>
            Create an account
          </Link>
        </>
      }
    >
      {verified && <Notice tone="ok">Email confirmed. You can sign in now.</Notice>}
      {reset && <Notice tone="ok">Password changed. Sign in with the new one.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {googleEnabled && (
        <>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
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
        <Field id="email" label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className={`text-xs ${linkCls}`}>
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
