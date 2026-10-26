"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { Catalog, ServiceListing } from "@/lib/types"
import KpiEditor, { rowsToKpis, toRow, type KpiRow } from "@/components/contracts/kpi-editor"
import ConditionsEditor, { hasEmptyCondition } from "@/components/contracts/conditions-editor"
import { Btn, ErrorNote, Field, Loading, Panel, inputCls } from "@/components/sla/ui"

// Form tạo / sửa dịch vụ của nhà cung cấp. Lưu nháp hoặc gửi admin duyệt.
export default function ListingEditor({ listing, onDone, onCancel }: { listing: ServiceListing | null; onDone: () => void; onCancel: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [form, setForm] = useState({
    title: listing?.title ?? "",
    category: listing?.category ?? "",
    description: listing?.description ?? "",
    website: listing?.website ?? "",
    priceNote: listing?.priceNote ?? "",
    challengeWindowHours: String(listing?.challengeWindowHours ?? 72),
  })
  const [rows, setRows] = useState<KpiRow[]>(listing ? listing.kpis.map(toRow) : [])
  const [conditions, setConditions] = useState<string[]>(listing?.additionalConditions ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api<Catalog>("/api/sla-builder/catalog")
      .then((c) => {
        setCatalog(c)
        // Dịch vụ mới: lấy KPI từ mẫu đầu tiên làm điểm bắt đầu
        if (!listing && c.templates[0]) {
          setRows(c.templates[0].kpis.map(toRow))
          setConditions(c.templates[0].conditions ?? [])
        }
      })
      .catch((e) => setError(e.message))
  }, [listing])

  const applyTemplate = (code: string) => {
    const t = catalog?.templates.find((x) => x.code === code)
    if (!t) return
    setRows(t.kpis.map(toRow))
    setConditions(t.conditions ?? [])
    setForm((f) => ({ ...f, category: f.category || t.serviceName, challengeWindowHours: String(t.challengeWindowHours) }))
  }

  const save = async (submit: boolean) => {
    if (!catalog) return
    if (!form.title.trim()) return setError("Nhập tên dịch vụ.")
    if (rows.length === 0) return setError("Dịch vụ cần ít nhất 1 KPI cam kết.")
    if (hasEmptyCondition(conditions)) return setError("Hãy điền nội dung hoặc xoá điều kiện bổ sung còn trống.")
    setBusy(submit ? "submit" : "draft")
    setError(null)
    try {
      const body = { ...form, challengeWindowHours: Number(form.challengeWindowHours), kpis: rowsToKpis(rows, catalog), additionalConditions: conditions.map((c) => c.trim()), submit }
      if (listing) await api(`/api/listings/${listing.id}`, { method: "PUT", body })
      else await api("/api/listings", { method: "POST", body })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được dịch vụ")
    } finally {
      setBusy(null)
    }
  }

  if (!catalog) return error ? <ErrorNote message={error} /> : <Loading />

  return (
    <div className="space-y-4">
      {listing?.status === "APPROVED" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Dịch vụ này đang hiển thị trên Marketplace. Lưu thay đổi sẽ <strong>tạm ẩn</strong> dịch vụ cho tới khi admin duyệt lại.
        </div>
      )}
      <Panel title={listing ? "Sửa dịch vụ" : "Dịch vụ mới"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên dịch vụ"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} placeholder="VD: Cloud Hosting doanh nghiệp" className={inputCls} /></Field>
          <Field label="Danh mục"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={80} placeholder="VD: Cloud Hosting" className={inputCls} /></Field>
          <Field label="Giá tham khảo (tuỳ chọn)"><input value={form.priceNote} onChange={(e) => setForm({ ...form, priceNote: e.target.value })} maxLength={150} placeholder="VD: Từ 5.000.000 ₫/tháng" className={inputCls} /></Field>
          <Field label="Website (tuỳ chọn)"><input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" className={inputCls} /></Field>
          <div className="sm:col-span-2">
            <Field label="Mô tả dịch vụ"><textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={3000} className={`${inputCls} h-auto py-2`} /></Field>
          </div>
          <Field label="Thời hạn phản đối vi phạm (giờ)" hint="Từ 24 đến 168 giờ">
            <input type="number" min={24} max={168} value={form.challengeWindowHours} onChange={(e) => setForm({ ...form, challengeWindowHours: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Bắt đầu từ mẫu (tuỳ chọn)">
            <select defaultValue="" onChange={(e) => e.target.value && applyTemplate(e.target.value)} className={inputCls}>
              <option value="">Chọn mẫu để điền KPI</option>
              {catalog.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
            </select>
          </Field>
        </div>
      </Panel>
      <KpiEditor catalog={catalog} rows={rows} setRows={setRows} />
      <ConditionsEditor conditions={conditions} setConditions={setConditions} />
      <ErrorNote message={error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Btn variant="ghost" onClick={onCancel}>Huỷ</Btn>
        <Btn variant="ghost" onClick={() => save(false)} loading={busy === "draft"}>Lưu nháp</Btn>
        <Btn onClick={() => save(true)} loading={busy === "submit"}>Gửi admin duyệt</Btn>
      </div>
    </div>
  )
}
