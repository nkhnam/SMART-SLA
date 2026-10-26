"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MessageSquare, Plus, Send, Ticket as TicketIcon } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import NegotiationSummary from "@/components/contracts/negotiation-summary"
import { myPartyOf } from "@/components/contracts/contracts-workspace"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { Contract, Party } from "@/lib/types"
import { Badge, Btn, Empty, ErrorNote, Loading, PARTY_LABEL, StatusBadge, fmtDateTime, inputCls } from "@/components/sla/ui"

type Message = { id: string; authorParty: Party; authorName: string; body: string; createdAt: string }
type Ticket = {
  id: string
  kind: "NEGOTIATION" | "SUPPORT"
  title: string
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  createdByParty: Party
  createdAt: string
  firstResponseAt: string | null
  resolvedAt: string | null
  source?: "BUILT_IN" | "WEBHOOK"
  messages?: Message[]
  _count?: { messages: number }
}

const TICKET_STATUS: Record<Ticket["status"], { label: string; tone: "amber" | "blue" | "green" | "slate" }> = {
  OPEN: { label: "Chờ phản hồi", tone: "amber" },
  IN_PROGRESS: { label: "Đang xử lý", tone: "blue" },
  RESOLVED: { label: "Đã giải quyết", tone: "green" },
  CLOSED: { label: "Đã đóng", tone: "slate" },
}

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
const fmtDuration = (m: number) => (m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`)

// Khung chat dùng chung cho Bàn bạc và Ticket hỗ trợ
function ChatThread({ ticket, myParty, onSend, sending }: { ticket: Ticket | null; myParty: Party | null; onSend: (text: string) => Promise<void>; sending: boolean }) {
  const [text, setText] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const count = ticket?.messages?.length ?? 0

  // Tin mới -> cuộn khung chat xuống cuối (chỉ cuộn trong khung, không kéo cả trang)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count, ticket?.id])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    await onSend(t)
    setText("")
  }

  const closed = ticket?.status === "CLOSED"
  return (
    <div className="flex min-h-[320px] flex-1 flex-col lg:min-h-0">
      <div ref={listRef} className="max-h-[60vh] min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 lg:max-h-none">
        {(ticket?.messages ?? []).map((m) => {
          const mine = m.authorParty === myParty
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-blue-600 text-white" : "border border-slate-700 bg-slate-900/80 text-slate-100"}`}>
                <p className={`mb-1 text-[11px] font-semibold ${mine ? "text-blue-100" : "text-slate-400"}`}>
                  {m.authorName} · {PARTY_LABEL[m.authorParty]}
                </p>
                <p className="whitespace-pre-wrap leading-6">{m.body}</p>
                <p className={`mt-1 text-[10px] ${mine ? "text-blue-200" : "text-slate-500"}`}>{fmtDateTime(m.createdAt)}</p>
              </div>
            </div>
          )
        })}
        {count === 0 && <p className="py-10 text-center text-sm text-slate-500">Chưa có tin nhắn. Hãy bắt đầu cuộc trao đổi.</p>}
      </div>
      {closed ? (
        <p className="mt-4 text-center text-xs text-slate-500">Ticket đã đóng.</p>
      ) : (
        <div className="mt-4 flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Nhập tin nhắn (Enter để gửi, Shift + Enter để xuống dòng)"
            className={`${inputCls} h-auto flex-1 resize-none py-2`}
            aria-label="Tin nhắn"
          />
          <Btn onClick={send} loading={sending} disabled={!text.trim()} aria-label="Gửi tin nhắn"><Send className="h-4 w-4" /></Btn>
        </div>
      )}
    </div>
  )
}

export default function NegotiationsWorkspace() {
  const { user } = useSession()
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [contractId, setContractId] = useState<string | null>(null)
  const [tab, setTab] = useState<"NEGOTIATION" | "SUPPORT">("NEGOTIATION")
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [active, setActive] = useState<Ticket | null>(null)
  const [newTicket, setNewTicket] = useState<{ title: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Lỗi của vòng tự cập nhật 5 giây: chỉ báo nhẹ và tự ẩn khi kết nối lại
  const [pollError, setPollError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Giữ id ticket đang mở trong ref để vòng tải lại 5 giây không phải khởi tạo lại
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeIdRef.current = active?.id ?? null
  }, [active])

  const contract = contracts?.find((c) => c.id === contractId) ?? null
  const myParty = contract ? myPartyOf(contract, user?.organization.id) : null

  useEffect(() => {
    api<Contract[]>("/api/contracts/list")
      .then((cs) => {
        setContracts(cs)
        if (cs[0]) setContractId(cs[0].id)
      })
      .catch((e) => setError(e.message))
  }, [])

  // Mỗi lần đổi tab / hợp đồng tăng số lượt; kết quả của lượt cũ về muộn thì bỏ qua (tránh hiện nhầm danh sách tab kia)
  const loadSeq = useRef(0)
  const loadTickets = useCallback(async () => {
    if (!contractId) return
    const seq = loadSeq.current
    try {
      const list = await api<Ticket[]>(`/api/contracts/${contractId}/tickets?kind=${tab}`, { timeoutMs: 30_000 })
      if (seq !== loadSeq.current) return
      setTickets(list.filter((t) => t.kind === tab))
      const targetId = tab === "NEGOTIATION" ? list[0]?.id : activeIdRef.current
      const detail = targetId ? await api<Ticket>(`/api/tickets/${targetId}`, { timeoutMs: 30_000 }) : null
      if (seq !== loadSeq.current) return
      setActive(detail && detail.kind === tab ? detail : null)
      setPollError(false)
    } catch {
      setPollError(true)
    }
  }, [contractId, tab])

  useEffect(() => {
    loadSeq.current += 1
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTickets([])
    loadTickets()
    const t = setInterval(loadTickets, 5000) // cập nhật tin nhắn mới của bên kia
    return () => clearInterval(t)
  }, [loadTickets])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra")
    } finally {
      setBusy(null)
    }
  }

  const sendMessage = (text: string) =>
    run("send", async () => {
      if (!contractId) return
      if (active) {
        setActive(await api<Ticket>(`/api/tickets/${active.id}/messages`, { method: "POST", body: { body: text } }))
      } else {
        // Luồng bàn bạc chưa có -> tạo mới bằng tin nhắn đầu tiên
        setActive(await api<Ticket>(`/api/contracts/${contractId}/tickets`, { method: "POST", body: { kind: "NEGOTIATION", message: text } }))
      }
      loadTickets()
    })

  const createTicket = () =>
    run("create", async () => {
      if (!contractId || !newTicket) return
      const t = await api<Ticket>(`/api/contracts/${contractId}/tickets`, { method: "POST", body: { kind: "SUPPORT", ...newTicket } })
      setNewTicket(null)
      setActive(t)
      loadTickets()
    })

  const setStatus = (status: "RESOLVED" | "CLOSED" | "OPEN") =>
    run(status, async () => {
      if (!active) return
      setActive(await api<Ticket>(`/api/tickets/${active.id}/status`, { method: "POST", body: { status } }))
      loadTickets()
    })

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Bàn bạc và hỗ trợ</h1>
        <p className="mt-2 text-sm text-slate-400">Trao đổi điều khoản trước khi ký, và mở ticket hỗ trợ khi hợp đồng đang hiệu lực. Hai bên cùng thấy, thời gian phản hồi được ghi nhận tự động.</p>

        <div className="mt-4"><ErrorNote message={error} /></div>
        {!contracts && !error && <Loading />}
        {contracts && contracts.length === 0 && <div className="mt-6"><Empty>Chưa có hợp đồng nào để trao đổi.</Empty></div>}

        {contracts && contracts.length > 0 && (
          <div className="mt-6 grid gap-6 lg:h-[calc(100vh-260px)] lg:min-h-[520px] lg:grid-cols-[280px_1fr]">
            <aside className="flex max-h-[45vh] min-h-0 flex-col rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-3 lg:max-h-none">
              <p className="px-2 pb-2 text-xs font-semibold text-slate-400">Hợp đồng</p>
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {contracts.map((c) => {
                  const party = myPartyOf(c, user?.organization.id)
                  const other = party === "SUPPLIER" ? c.client.name : c.provider.name
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => { setContractId(c.id); setActive(null); setNewTicket(null) }}
                        aria-current={c.id === contractId}
                        className={`w-full rounded-xl px-3 py-2.5 text-left ${c.id === contractId ? "bg-blue-500/15" : "hover:bg-slate-800/60"}`}
                      >
                        <p className="font-mono text-sm font-bold text-white">{c.contractCode}</p>
                        <p className="truncate text-xs text-slate-400">{other} · {c.serviceName}</p>
                        <div className="mt-1"><StatusBadge status={c.status} /></div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </aside>

            <section className="flex min-h-0 flex-col rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Loại trao đổi">
                <button type="button" role="tab" aria-selected={tab === "NEGOTIATION"} onClick={() => { setTab("NEGOTIATION"); setActive(null); setNewTicket(null) }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === "NEGOTIATION" ? "bg-violet-500/15 text-white" : "text-slate-400"}`}>
                  <MessageSquare className="h-4 w-4" /> Bàn bạc điều khoản
                </button>
                <button type="button" role="tab" aria-selected={tab === "SUPPORT"} onClick={() => { setTab("SUPPORT"); setActive(null); setNewTicket(null) }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === "SUPPORT" ? "bg-blue-500/15 text-white" : "text-slate-400"}`}>
                  <TicketIcon className="h-4 w-4" /> Ticket hỗ trợ
                </button>
                {pollError && <span className="text-xs text-amber-300" role="status">Mất kết nối tạm thời, đang thử lại…</span>}
                {contract && myParty && <span className="ml-auto text-xs text-slate-500">Bạn là {PARTY_LABEL[myParty].toLowerCase()}</span>}
              </div>

              {tab === "NEGOTIATION" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  {contractId && <div className="max-h-[40%] shrink-0 overflow-y-auto">{<NegotiationSummary contractId={contractId} contractStatus={contract?.status} />}</div>}
                  <ChatThread ticket={active} myParty={myParty} onSend={sendMessage} sending={busy === "send"} />
                </div>
              )}

              {tab === "SUPPORT" && (
                <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[300px_1fr]">
                  <div className="flex min-h-0 flex-col">
                    <Btn variant="ghost" className="w-full shrink-0" onClick={() => { setNewTicket({ title: "", message: "" }); setActive(null) }}><Plus className="h-4 w-4" />Mở ticket mới</Btn>
                    <ul className="mt-3 max-h-[40vh] min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 xl:max-h-none">
                      {tickets.map((t) => (
                        <li key={t.id}>
                          <button type="button" onClick={() => { setNewTicket(null); run("open", async () => setActive(await api<Ticket>(`/api/tickets/${t.id}`))) }} aria-current={active?.id === t.id} className={`w-full rounded-xl border px-3 py-2.5 text-left ${active?.id === t.id ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-500"}`}>
                            <p className="truncate text-sm font-semibold text-white">{t.title}</p>
                            {t.source === "WEBHOOK" && <p className="text-[11px] text-cyan-300">Nhận qua webhook</p>}
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <Badge tone={TICKET_STATUS[t.status].tone}>{TICKET_STATUS[t.status].label}</Badge>
                              <span className="text-[11px] text-slate-500">{fmtDateTime(t.createdAt)}</span>
                            </div>
                          </button>
                        </li>
                      ))}
                      {tickets.length === 0 && !newTicket && <p className="py-4 text-center text-xs text-slate-500">Chưa có ticket.</p>}
                    </ul>
                  </div>

                  <div className="flex min-h-0 flex-col overflow-y-auto">
                    {newTicket ? (
                      <div className="space-y-3">
                        <p className="text-sm font-bold text-white">Ticket mới</p>
                        <input value={newTicket.title} onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })} maxLength={200} placeholder="Tiêu đề, VD: Website không truy cập được" className={inputCls} aria-label="Tiêu đề ticket" />
                        <textarea value={newTicket.message} onChange={(e) => setNewTicket({ ...newTicket, message: e.target.value })} rows={5} maxLength={4000} placeholder="Mô tả sự cố" className={`${inputCls} h-auto py-2`} aria-label="Mô tả sự cố" />
                        <div className="flex gap-2">
                          <Btn onClick={createTicket} loading={busy === "create"} disabled={!newTicket.title.trim() || !newTicket.message.trim()}>Gửi ticket</Btn>
                          <Btn variant="ghost" onClick={() => setNewTicket(null)}>Huỷ</Btn>
                        </div>
                      </div>
                    ) : active ? (
                      <div className="flex min-h-0 flex-1 flex-col">
                        <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
                          <div>
                            <p className="text-base font-bold text-white">{active.title}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {active.source === "WEBHOOK" ? "Nhận qua webhook" : `Mở bởi ${PARTY_LABEL[active.createdByParty].toLowerCase()}`} lúc {fmtDateTime(active.createdAt)}
                              {active.firstResponseAt && ` · Phản hồi sau ${fmtDuration(minutesBetween(active.createdAt, active.firstResponseAt))}`}
                              {active.resolvedAt && ` · Giải quyết sau ${fmtDuration(minutesBetween(active.createdAt, active.resolvedAt))}`}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={TICKET_STATUS[active.status].tone}>{TICKET_STATUS[active.status].label}</Badge>
                            {myParty === "SUPPLIER" && ["OPEN", "IN_PROGRESS"].includes(active.status) && (
                              <Btn variant="ghost" onClick={() => setStatus("RESOLVED")} loading={busy === "RESOLVED"}>Đánh dấu đã giải quyết</Btn>
                            )}
                            {myParty === active.createdByParty && active.status === "RESOLVED" && (
                              <>
                                <Btn variant="ghost" onClick={() => setStatus("CLOSED")} loading={busy === "CLOSED"}>Xác nhận và đóng</Btn>
                                <Btn variant="danger" onClick={() => setStatus("OPEN")} loading={busy === "OPEN"}>Chưa xong, mở lại</Btn>
                              </>
                            )}
                          </div>
                        </div>
                        <ChatThread ticket={active} myParty={myParty} onSend={sendMessage} sending={busy === "send"} />
                      </div>
                    ) : (
                      <Empty>Chọn một ticket hoặc mở ticket mới.</Empty>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </AppShell>
  )
}
