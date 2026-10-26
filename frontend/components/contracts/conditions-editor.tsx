"use client"

import { Plus, RotateCcw, Trash2 } from "lucide-react"
import { Panel, inputCls } from "@/components/sla/ui"

const MAX = 20

// Điều kiện bổ sung: văn bản hai bên tự thống nhất. Hệ thống không đo tự động,
// nhưng nội dung được băm vào hash hợp đồng và ký cùng điều khoản KPI.
export default function ConditionsEditor({
  conditions,
  setConditions,
  suggestions,
}: {
  conditions: string[]
  setConditions: React.Dispatch<React.SetStateAction<string[]>>
  suggestions?: string[] // điều kiện gợi ý của mẫu đang chọn
}) {
  const update = (i: number, v: string) => setConditions((items) => items.map((x, idx) => (idx === i ? v : x)))
  const remove = (i: number) => setConditions((items) => items.filter((_, idx) => idx !== i))

  return (
    <Panel
      title="Điều kiện bổ sung"
      action={
        suggestions && suggestions.length > 0 ? (
          <button type="button" onClick={() => setConditions(suggestions)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white">
            <RotateCcw className="h-3.5 w-3.5" /> Khôi phục điều kiện gợi ý của mẫu
          </button>
        ) : null
      }
    >
      <p className="mb-4 text-xs leading-5 text-slate-400">
        Các điều kiện do hai bên tự bàn bạc và xác nhận. Hệ thống không tự đo hoặc tự thực thi các nội dung này, nhưng chúng được băm vào hợp đồng và ký cùng KPI: sửa một chữ sau khi ký sẽ bị phát hiện khi kiểm chứng.
      </p>
      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div key={index} className="flex items-start gap-2">
            <label className="min-w-0 flex-1 text-xs font-semibold text-slate-300">
              Điều kiện {index + 1}
              <textarea
                value={condition}
                onChange={(e) => update(index, e.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Nội dung hai bên đã thống nhất…"
                className={`${inputCls} mt-1.5 h-auto min-h-20 resize-y py-2`}
              />
            </label>
            <button type="button" onClick={() => remove(index)} className="mt-6 grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300" aria-label={`Xoá điều kiện ${index + 1}`}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {conditions.length === 0 && <p className="text-sm text-slate-500">Chưa có điều kiện bổ sung.</p>}
      </div>
      <button
        type="button"
        onClick={() => setConditions((items) => [...items, ""])}
        disabled={conditions.length >= MAX}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-400/30 px-4 text-xs font-bold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />Thêm điều kiện
      </button>
      <span className="ml-3 text-[11px] text-slate-500">{conditions.length}/{MAX}</span>
    </Panel>
  )
}

// Hiển thị điều kiện bổ sung (trang hợp đồng, xem trước dịch vụ)
export function ConditionsView({ conditions }: { conditions?: string[] | null }) {
  return conditions?.length ? (
    <ol className="list-outside list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-200">
      {conditions.map((c, i) => <li key={i} className="whitespace-pre-wrap">{c}</li>)}
    </ol>
  ) : (
    <p className="text-sm text-slate-500">Không có điều kiện bổ sung.</p>
  )
}

export const hasEmptyCondition = (list: string[]) => list.some((c) => !c.trim())
