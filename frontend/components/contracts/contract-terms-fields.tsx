"use client"

import { Field, inputCls } from "@/components/sla/ui"
import { digitsOnly, groupDigits } from "@/lib/terms"

export type TermsValue = { value: string; from: string; to: string }

// Kiểm tra trước khi gửi (backend vẫn kiểm tra lại)
export function termsError(t: TermsValue): string | null {
  if (!t.value || Number(t.value) < 1000) return "Nhập giá trị hợp đồng (tối thiểu 1.000 VNĐ/tháng)."
  if (!t.from || !t.to) return "Chọn ngày hiệu lực và ngày hết hạn."
  if (t.to < t.from) return "Ngày hết hạn phải sau hoặc trùng ngày hiệu lực."
  return null
}

export const termsBody = (t: TermsValue) => ({ contractValueVnd: Number(t.value), effectiveFrom: t.from, effectiveTo: t.to })

// Giá trị hợp đồng (VNĐ/tháng) + ngày hiệu lực + ngày hết hạn
export default function ContractTermsFields({ value, onChange }: { value: TermsValue; onChange: (v: TermsValue) => void }) {
  return (
    <>
      <Field label="Giá trị hợp đồng (VNĐ/tháng)" hint="Phí dịch vụ mỗi tháng. Mức hoàn phí khi vi phạm được quy ra tiền dựa trên số này">
        <input
          inputMode="numeric"
          value={groupDigits(value.value)}
          onChange={(e) => onChange({ ...value, value: digitsOnly(e.target.value) })}
          placeholder="VD: 50.000.000"
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ngày hiệu lực">
          <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Ngày hết hạn" hint="Hiệu lực đến hết ngày này">
          <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className={inputCls} />
        </Field>
      </div>
    </>
  )
}
