"use client"

import { useState } from "react"
import { Check, PencilLine, X } from "lucide-react"
import { api } from "@/lib/api"
import { inputCls } from "@/components/sla/ui"

// Tên hợp đồng: hiện to ở đầu trang, bên nào cũng đổi được (nhãn quản lý, không ảnh hưởng chữ ký)
export default function ContractName({ id, name, fallback, canEdit, onSaved }: { id: string; name?: string | null; fallback: string; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/contracts/${id}/name`, { method: "PUT", body: { contractName: value.trim() } })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được tên")
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="mt-2">
        <div className="flex max-w-xl items-center gap-2">
          <input
            autoFocus
            value={value}
            maxLength={120}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false) }}
            placeholder="VD: Hosting website bán hàng 2026"
            className={inputCls}
            aria-label="Tên hợp đồng"
          />
          <button type="button" onClick={save} disabled={busy} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border" aria-label="Lưu tên"><Check className="h-4 w-4" /></button>
          <button type="button" onClick={() => { setEditing(false); setValue(name ?? "") }} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border" aria-label="Huỷ"><X className="h-4 w-4" /></button>
        </div>
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <p className={`text-xl font-bold ${name ? "text-white" : "text-slate-400"}`}>{name || fallback}</p>
      {canEdit && (
        <button type="button" onClick={() => { setValue(name ?? ""); setEditing(true) }} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-xs font-semibold" title="Đặt / đổi tên hợp đồng">
          <PencilLine className="h-3.5 w-3.5" />{name ? "Đổi tên" : "Đặt tên"}
        </button>
      )}
    </div>
  )
}
