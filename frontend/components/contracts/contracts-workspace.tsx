"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { FilePlus2, Search } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { Contract, Party } from "@/lib/types"
import { Empty, ErrorNote, Loading, PARTY_LABEL, StatusBadge, fmtDateTime, inputCls } from "@/components/sla/ui"

type Mode = "received" | "sent"

export function myPartyOf(c: Contract, orgId?: string): Party | null {
  if (!orgId) return null
  if (c.client.id === orgId) return "BUYER"
  if (c.provider.organizationId === orgId) return "SUPPLIER"
  return null
}

export default function ContractsWorkspace({ initialMode }: { initialMode: Mode }) {
  const { user } = useSession()
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")

  useEffect(() => {
    api<Contract[]>("/api/contracts/list")
      .then(setContracts)
      .catch((err) => setError(err.message))
  }, [])

  // "Chờ tôi ký": hợp đồng chờ ký mà bên mình chưa ký
  const needsMySignature = (c: Contract) => {
    if (c.status !== "PENDING_SIGNATURE") return false
    const party = myPartyOf(c, user?.organization.id)
    if (!c.signatures || !party) return true
    return !c.signatures.some((s) => s.party === party && s.signedAt)
  }

  const list = useMemo(() => {
    const base = (contracts ?? []).filter((c) => (initialMode === "received" ? needsMySignature(c) : true))
    const k = q.trim().toLowerCase()
    return k ? base.filter((c) => [c.contractCode, c.contractName, c.serviceName, c.client.name, c.provider.name].some((v) => v?.toLowerCase().includes(k))) : base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, initialMode, q, user])

  const pendingCount = (contracts ?? []).filter(needsMySignature).length

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Hợp đồng của tôi</h1>
            <p className="mt-2 text-sm text-slate-400">Hợp đồng mà {user?.organization.name} là một bên.</p>
          </div>
          <Link href="/create-sla" className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">
            <FilePlus2 className="h-4 w-4" /> Tạo hợp đồng
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Link href="/contracts" className={`rounded-lg px-3 py-2 text-sm font-semibold ${initialMode === "received" ? "bg-violet-500/15 text-white" : "text-slate-400 hover:text-white"}`}>
            Chờ tôi ký {pendingCount > 0 && <span className="ml-1 rounded-full bg-violet-400 px-1.5 text-[10px] text-slate-950">{pendingCount}</span>}
          </Link>
          <Link href="/contracts/sent" className={`rounded-lg px-3 py-2 text-sm font-semibold ${initialMode === "sent" ? "bg-blue-500/15 text-white" : "text-slate-400 hover:text-white"}`}>
            Tất cả hợp đồng
          </Link>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, mã, dịch vụ, đối tác…" className={`${inputCls} pl-9`} aria-label="Tìm hợp đồng" />
          </div>
        </div>

        <div className="mt-6">
          <ErrorNote message={error} />
          {!contracts && !error && <Loading />}
          {contracts && list.length === 0 && (
            <Empty>{initialMode === "received" ? "Không có hợp đồng nào đang chờ bạn ký." : "Chưa có hợp đồng. Bấm “Tạo hợp đồng” để bắt đầu."}</Empty>
          )}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-slate-700/70 bg-[#0b1424]/85">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-700/70 text-xs text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Hợp đồng</th>
                    <th className="px-4 py-3 font-semibold">Đối tác</th>
                    <th className="px-4 py-3 font-semibold">Dịch vụ</th>
                    <th className="px-4 py-3 font-semibold">KPI</th>
                    <th className="px-4 py-3 font-semibold">Trạng thái</th>
                    <th className="px-4 py-3 font-semibold">Tạo lúc</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const party = myPartyOf(c, user?.organization.id)
                    const other = party === "SUPPLIER" ? c.client.name : c.provider.name
                    return (
                      <tr key={c.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <Link href={`/contracts/${c.id}`} className="block font-semibold text-white hover:text-blue-300">{c.contractName || <span className="font-normal italic text-slate-500">Chưa đặt tên</span>}</Link>
                          <span className="font-mono text-xs font-medium text-blue-300">{c.contractCode}</span>
                          {party && <p className="text-[11px] text-slate-500">Bạn là {PARTY_LABEL[party].toLowerCase()}</p>}
                        </td>
                        <td className="px-4 py-3 text-slate-200">{other}</td>
                        <td className="px-4 py-3 text-slate-300">{c.serviceName}</td>
                        <td className="px-4 py-3 text-xs text-slate-400">{c.kpis.map((k) => `${k.name} ${k.comparator === "GTE" ? "≥" : "≤"} ${k.target}${k.unit}`).join(" · ") || "—"}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                        <td className="px-4 py-3 text-xs text-slate-400">{fmtDateTime(c.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
