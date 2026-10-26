"use client"

import { useState } from "react"
import Link from "next/link"
import { PencilLine } from "lucide-react"
import { api } from "@/lib/api"
import type { Catalog, Contract } from "@/lib/types"
import KpiEditor, { rowsToKpis, toRow, type KpiRow } from "@/components/contracts/kpi-editor"
import ConditionsEditor, { hasEmptyCondition } from "@/components/contracts/conditions-editor"
import ContractTermsFields, { termsBody, termsError, type TermsValue } from "@/components/contracts/contract-terms-fields"
import { oneYearLater, todayVn, vnDate } from "@/lib/terms"
import { Btn, ErrorNote, Field, Panel, inputCls } from "@/components/sla/ui"

// Sửa điều khoản khi hợp đồng còn "Chờ ký". Lưu xong: mọi chữ ký cũ bị huỷ, hệ thống ghi vào luồng Bàn bạc.
export default function EditTermsPanel({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [rows, setRows] = useState<KpiRow[]>([])
  const [conditions, setConditions] = useState<string[]>([])
  const [service, setService] = useState(contract.serviceName)
  const [hours, setHours] = useState(String(Math.round(contract.challengeWindowSeconds / 3600)))
  const [note, setNote] = useState("")
  const [terms, setTerms] = useState<TermsValue>({ value: "", from: "", to: "" })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const start = async () => {
    setError(null)
    setSaved(false)
    try {
      const c = catalog ?? (await api<Catalog>("/api/sla-builder/catalog"))
      setCatalog(c)
      setRows(contract.kpis.map(toRow))
      setConditions(contract.additionalConditions ?? [])
      setService(contract.serviceName)
      setHours(String(Math.round(contract.challengeWindowSeconds / 3600)))
      setNote("")
      // Hợp đồng cũ chưa có giá trị / thời hạn: gợi ý từ hôm nay, 12 tháng
      const from = vnDate(contract.effectiveFrom) || todayVn()
      setTerms({ value: contract.contractValueVnd ? String(contract.contractValueVnd) : "", from, to: vnDate(contract.effectiveTo) || oneYearLater(from) })
      setOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được thư viện KPI")
    }
  }

  const save = async () => {
    if (!catalog) return
    const tErr = termsError(terms)
    if (tErr) return setError(tErr)
    if (rows.length === 0) return setError("Hợp đồng cần ít nhất 1 KPI.")
    if (hasEmptyCondition(conditions)) return setError("Hãy điền nội dung hoặc xoá điều kiện bổ sung còn trống.")
    setBusy(true)
    setError(null)
    try {
      await api(`/api/contracts/${contract.id}/terms`, {
        method: "PUT",
        body: { service, challengeWindowHours: Number(hours), kpis: rowsToKpis(rows, catalog), additionalConditions: conditions.map((c) => c.trim()), ...termsBody(terms), note: note.trim() || undefined },
      })
      setOpen(false)
      setSaved(true)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được điều khoản")
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Panel
        title="Thương lượng điều khoản"
        action={<Btn variant="ghost" onClick={start}><PencilLine className="h-4 w-4" />Sửa điều khoản</Btn>}
      >
        <p className="text-sm text-slate-300">
          Hợp đồng chưa đủ chữ ký nên hai bên vẫn có thể sửa điều khoản. Trao đổi trước trong{" "}
          <Link href="/negotiations" className="font-semibold text-blue-300 hover:text-blue-200">Bàn bạc</Link>. Mỗi lần sửa, các chữ ký đã có sẽ bị huỷ và hai bên ký lại trên nội dung mới.
        </p>
        {saved && <p className="mt-3 text-sm text-emerald-300" role="status">Đã lưu điều khoản mới (phiên bản {contract.termsVersion ?? ""}). Bên kia đã được báo trong luồng Bàn bạc.</p>}
        <div className="mt-3"><ErrorNote message={error} /></div>
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <Panel title="Sửa điều khoản">
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Lưu thay đổi sẽ <strong>huỷ mọi chữ ký đã có</strong> của hợp đồng này. Hai bên phải ký lại trên nội dung mới.
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dịch vụ"><input value={service} onChange={(e) => setService(e.target.value)} className={inputCls} /></Field>
          <ContractTermsFields value={terms} onChange={setTerms} />
          <Field label="Thời hạn phản đối (giờ)" hint="Từ 24 đến 168 giờ">
            <input type="number" min={24} max={168} value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ghi chú cho bên kia (tuỳ chọn)" hint="Hiển thị trong luồng Bàn bạc cùng nội dung thay đổi">
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: Đề xuất nâng thời gian phản hồi lên 300ms theo trao đổi" className={inputCls} />
            </Field>
          </div>
        </div>
      </Panel>
      {catalog && <KpiEditor catalog={catalog} rows={rows} setRows={setRows} />}
      <ConditionsEditor conditions={conditions} setConditions={setConditions} />
      <ErrorNote message={error} />
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" onClick={() => setOpen(false)}>Huỷ</Btn>
        <Btn onClick={save} loading={busy}>Lưu điều khoản mới</Btn>
      </div>
    </div>
  )
}
