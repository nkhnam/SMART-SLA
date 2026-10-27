"use client";

import { useState, type FormEvent } from "react";
import { ApiError, type AgreementInput, type LiveAgreement } from "@/lib/live-api";

type Props = {
  agreement?: LiveAgreement;
  readOnly?: boolean;
  submitLabel: string;
  onSave: (input: AgreementInput) => Promise<void>;
};

export function AgreementEditor({ agreement, readOnly = false, submitLabel, onSave }: Props) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const notes = String(form.get("notes")).trim();
    const input: AgreementInput = {
      name: String(form.get("name")),
      serviceDescription: String(form.get("serviceDescription")),
      counterpartyDisplayName: String(form.get("counterpartyDisplayName")),
      terms: {
        uptimeTargetPercent: Number(form.get("uptimeTargetPercent")),
        responseTimeTargetMs: Number(form.get("responseTimeTargetMs")),
        measurementWindowHours: Number(form.get("measurementWindowHours")),
        exclusions: String(form.get("exclusions")).split("\n").map((item) => item.trim()).filter(Boolean),
        ...(notes ? { notes } : {})
      }
    };
    try {
      await onSave(input);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause : new ApiError("The draft could not be saved."));
    } finally {
      setPending(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm disabled:bg-slate-50";
  return <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-white p-5 sm:p-6">
    {agreement && <p className="text-xs text-muted">{agreement.reference} · Draft · Version {agreement.version}</p>}
    <label className="block text-sm font-medium">Agreement name
      <input required name="name" maxLength={160} defaultValue={agreement?.name ?? ""} disabled={readOnly || pending} className={inputClass} />
    </label>
    <label className="block text-sm font-medium">Service description
      <textarea required name="serviceDescription" maxLength={4000} rows={3} defaultValue={agreement?.serviceDescription ?? ""} disabled={readOnly || pending} className={inputClass} />
    </label>
    <label className="block text-sm font-medium">Counterparty display name <span className="font-normal text-muted">Unverified</span>
      <input required name="counterpartyDisplayName" maxLength={160} defaultValue={agreement?.counterpartyDisplayName ?? ""} disabled={readOnly || pending} className={inputClass} />
      <span className="mt-1 block text-xs font-normal text-muted">This name is informational and does not grant another organization access.</span>
    </label>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block text-sm font-medium">Uptime target (%)
        <input required type="number" step="0.01" min="0.01" max="100" name="uptimeTargetPercent" defaultValue={agreement?.terms.uptimeTargetPercent ?? 99.95} disabled={readOnly || pending} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">Response target (ms)
        <input required type="number" step="1" min="1" max="600000" name="responseTimeTargetMs" defaultValue={agreement?.terms.responseTimeTargetMs ?? 180} disabled={readOnly || pending} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">Measurement window (hours)
        <input required type="number" step="1" min="1" max="8760" name="measurementWindowHours" defaultValue={agreement?.terms.measurementWindowHours ?? 24} disabled={readOnly || pending} className={inputClass} />
      </label>
    </div>
    <label className="block text-sm font-medium">Exclusions <span className="font-normal text-muted">One per line</span>
      <textarea name="exclusions" maxLength={6000} rows={3} defaultValue={agreement?.terms.exclusions.join("\n") ?? ""} disabled={readOnly || pending} className={inputClass} />
    </label>
    <label className="block text-sm font-medium">Notes <span className="font-normal text-muted">Optional</span>
      <textarea name="notes" maxLength={2000} rows={3} defaultValue={agreement?.terms.notes ?? ""} disabled={readOnly || pending} className={inputClass} />
    </label>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">
      <p>{error.message}</p>
      {error.status === 409 && <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold underline">Reload the latest version</button>}
    </div>}
    {!readOnly && <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : submitLabel}</button>}
  </form>;
}
