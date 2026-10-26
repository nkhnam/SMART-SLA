"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, login, register, type OrganizationType } from "@/lib/live-api";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await login({ email: String(form.get("email")), password: String(form.get("password")) });
      router.push("/workspace/agreements");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign in could not be completed.");
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium">Email
      <input required autoComplete="email" type="email" name="email" maxLength={320} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    <label className="block text-sm font-medium">Password
      <input required autoComplete="current-password" type="password" name="password" maxLength={128} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button disabled={pending} type="submit" className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}

export function RegistrationForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await register({
        email: String(form.get("email")),
        password: String(form.get("password")),
        displayName: String(form.get("displayName")),
        organizationName: String(form.get("organizationName")),
        organizationType: String(form.get("organizationType")) as OrganizationType
      });
      router.push("/workspace/agreements");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Account registration could not be completed.");
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={submit} className="space-y-4">
    <label className="block text-sm font-medium">Your name
      <input required autoComplete="name" name="displayName" maxLength={120} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    <label className="block text-sm font-medium">Email
      <input required autoComplete="email" type="email" name="email" maxLength={320} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    <label className="block text-sm font-medium">Password <span className="font-normal text-muted">At least 12 characters</span>
      <input required autoComplete="new-password" type="password" name="password" minLength={12} maxLength={128} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    <label className="block text-sm font-medium">Organization name
      <input required name="organizationName" maxLength={160} className="mt-2 w-full rounded-lg border border-border px-3 py-2.5" />
    </label>
    <label className="block text-sm font-medium">Organization type
      <select name="organizationType" className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2.5">
        <option value="CUSTOMER">Customer</option>
        <option value="PROVIDER">Service provider</option>
        <option value="OTHER">Other</option>
      </select>
    </label>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button disabled={pending} type="submit" className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Creating account…" : "Create account"}</button>
  </form>;
}

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  const title = mode === "login" ? "Sign in to SLA-DEX" : "Create your live workspace";
  const subtitle = mode === "login"
    ? "Access draft agreements for your organization."
    : "Registration creates your user, organization, and OWNER membership.";
  return <main className="mx-auto flex min-h-screen max-w-6xl items-center px-5 py-12 sm:px-8">
    <section className="mx-auto w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-sm sm:p-8">
      <Link href="/" className="text-sm font-bold tracking-wide">SLA-DEX</Link>
      <p className="mt-7 text-xs font-semibold uppercase tracking-wide text-brand">Live workspace</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted">{subtitle}</p>
      <div className="mt-6">{mode === "login" ? <LoginForm /> : <RegistrationForm />}</div>
      <p className="mt-5 text-sm text-muted">{mode === "login" ? <>New here? <Link href="/register" className="font-semibold text-brand">Create an account</Link></> : <>Already registered? <Link href="/login" className="font-semibold text-brand">Sign in</Link></>}</p>
      <Link href="/overview" className="mt-4 inline-block text-sm font-semibold text-muted hover:text-brand">Open Demo Mode</Link>
    </section>
  </main>;
}
