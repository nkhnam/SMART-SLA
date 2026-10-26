"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Circle, Mail, Smartphone, Wallet } from "lucide-react"
import { api } from "@/lib/api"
import { AMOY_CHAIN_ID, connectWallet, currentChainId, disconnectWalletConnect, hasWallet, signTypedData, switchToAmoy, walletConnectEnabled, walletErrorMessage, type WalletKind } from "@/lib/wallet"
import { Btn, ErrorNote, PARTY_LABEL, Panel, fmtDateTime, inputCls } from "@/components/sla/ui"

type Side = {
  party: "BUYER" | "SUPPLIER"
  organization: string
  declaredWallet: string | null
  signed: boolean
  signerAddress: string | null
  signedAt: string | null
  method: string | null
}
type SigningStatus = {
  contractCode: string
  status: string
  signingRequired: boolean
  myParty: "BUYER" | "SUPPLIER"
  parties: Side[]
  toSign: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> } | null
  otpAvailable: boolean
}

// Ký hợp đồng: ví EIP-712 (miễn phí, không tốn gas) hoặc mã OTP gửi email
export default function SigningPanel({ contractId, onSigned }: { contractId: string; onSigned: () => void }) {
  const [st, setSt] = useState<SigningStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<"wallet" | "otp">("wallet")
  const [walletInput, setWalletInput] = useState("")
  const [wrongNetwork, setWrongNetwork] = useState<WalletKind | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [info, setInfo] = useState<string | null>(null)
  // Đổi ví đã khai báo (chỉ khi bên mình chưa ký)
  const [changingWallet, setChangingWallet] = useState(false)

  const load = useCallback(async () => {
    try {
      setSt(await api<SigningStatus>(`/api/contracts/${contractId}/signing`))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được trạng thái ký")
    }
  }, [contractId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setInfo(null)
      setError(walletErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (!st) return <Panel title="Ký hợp đồng">{error ? <ErrorNote message={error} /> : <p className="text-sm text-slate-400">Đang tải…</p>}</Panel>
  if (!st.signingRequired) return null

  const mine = st.parties.find((p) => p.party === st.myParty)!
  const finished = st.status !== "PENDING_SIGNATURE"

  const declare = (address: string) =>
    run("declare", async () => {
      setSt(await api<SigningStatus>(`/api/contracts/${contractId}/signer`, { method: "POST", body: { walletAddress: address } }))
      setChangingWallet(false)
      setWrongNetwork(null)
    })

  const connectAndDeclare = (kind: WalletKind) =>
    run(`connect-${kind}`, async () => {
      const address = await connectWallet(kind)
      setWalletInput(address)
      setSt(await api<SigningStatus>(`/api/contracts/${contractId}/signer`, { method: "POST", body: { walletAddress: address } }))
      setChangingWallet(false)
      setWrongNetwork(null)
    })

  const sign = (kind: WalletKind) =>
    run(`sign-${kind}`, async () => {
      if (!st.toSign || !mine.declaredWallet) return
      const address = await connectWallet(kind)
      if (address.toLowerCase() !== mine.declaredWallet.toLowerCase()) {
        throw new Error(`Ví đang kết nối (${address}) khác ví đã khai báo. Hãy chọn đúng ví ${mine.declaredWallet}.`)
      }
      // Chữ ký EIP-712 gắn với mạng Polygon Amoy: ví phải đang ở đúng mạng
      if ((await currentChainId(kind)) !== AMOY_CHAIN_ID) {
        setWrongNetwork(kind)
        throw new Error("Ví đang ở sai mạng. Hãy chuyển sang Polygon Amoy rồi ký lại.")
      }
      if (kind === "walletconnect") setInfo("Mở app ví trên điện thoại để xác nhận chữ ký…")
      const signature = await signTypedData(kind, mine.declaredWallet, st.toSign.domain, st.toSign.types, st.toSign.message)
      setInfo(null)
      const next = await api<SigningStatus>(`/api/contracts/${contractId}/sign`, {
        method: "POST",
        body: { signature, issuedAt: st.toSign.message.issuedAt },
        timeoutMs: 120_000,
      })
      setSt(next)
      onSigned()
    })

  const sendOtp = () =>
    run("otp-send", async () => {
      const r = await api<{ email: string }>(`/api/contracts/${contractId}/sign-otp/request`, { method: "POST", timeoutMs: 60_000 })
      setOtpSentTo(r.email)
    })

  const verifyOtp = () =>
    run("otp-verify", async () => {
      setSt(await api<SigningStatus>(`/api/contracts/${contractId}/sign-otp/verify`, { method: "POST", body: { code }, timeoutMs: 120_000 }))
      onSigned()
    })

  return (
    <Panel title="Ký hợp đồng">
      <ul className="grid gap-3 sm:grid-cols-2">
        {st.parties.map((p) => (
          <li key={p.party} className="flex items-start gap-3 rounded-xl border border-slate-700/80 p-3">
            {p.signed ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /> : <Circle className="mt-0.5 h-5 w-5 text-slate-500" />}
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-white">{PARTY_LABEL[p.party]}: {p.organization}{p.party === st.myParty && " (bạn)"}</p>
              {p.signed ? (
                <p className="text-xs text-emerald-300">Đã ký {p.method === "OTP_EMAIL" ? "bằng OTP email" : "bằng ví"} lúc {fmtDateTime(p.signedAt)}</p>
              ) : p.declaredWallet ? (
                <p className="truncate text-xs text-slate-400">Sẽ ký bằng ví <span className="font-mono">{p.declaredWallet}</span></p>
              ) : (
                <p className="text-xs text-slate-400">Chưa ký</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {finished && <p className="mt-4 text-sm text-emerald-300">Hai bên đã ký. Hợp đồng đã có hiệu lực và được ghi dấu trên Polygon.</p>}

      {!finished && !mine.signed && (
        <div className="mt-5 rounded-xl border border-slate-700/80 p-4">
          <div className="mb-4 flex gap-2" role="tablist" aria-label="Cách ký">
            <button type="button" role="tab" aria-selected={method === "wallet"} onClick={() => setMethod("wallet")} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${method === "wallet" ? "bg-blue-500/15 text-white" : "text-slate-400"}`}>
              <Wallet className="h-4 w-4" /> Ký bằng ví
            </button>
            {st.otpAvailable && (
              <button type="button" role="tab" aria-selected={method === "otp"} onClick={() => setMethod("otp")} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${method === "otp" ? "bg-blue-500/15 text-white" : "text-slate-400"}`}>
                <Mail className="h-4 w-4" /> Ký bằng mã OTP
              </button>
            )}
          </div>

          {method === "wallet" && (
            <div className="space-y-4">
              <p className="text-xs leading-5 text-slate-400">
                Ký bằng ví EVM: ví tiện ích trên máy tính, hoặc app ví trên điện thoại qua mã QR (MetaMask, Trust, OKX…). Ký là miễn phí, không chuyển tiền và không tốn phí gas. Ví sẽ hiển thị nội dung bạn xác nhận trước khi ký.
              </p>
              {!mine.declaredWallet || changingWallet ? (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white">{changingWallet ? "Đổi ví người ký" : "Bước 1: khai báo ví người ký"}</p>
                  {changingWallet && (
                    <p className="text-xs text-slate-400">Ví hiện tại: <span className="font-mono">{mine.declaredWallet}</span>. Chọn ví trên trình duyệt (đang mở trong MetaMask), quét QR, hoặc nhập địa chỉ ví mới.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {hasWallet() && <Btn onClick={() => connectAndDeclare("injected")} loading={busy === "connect-injected"}><Wallet className="h-4 w-4" />Ví trên trình duyệt</Btn>}
                    {walletConnectEnabled() && <Btn variant={hasWallet() ? "ghost" : "primary"} onClick={() => connectAndDeclare("walletconnect")} loading={busy === "connect-walletconnect"}><Smartphone className="h-4 w-4" />Ví điện thoại (quét QR)</Btn>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input value={walletInput} onChange={(e) => setWalletInput(e.target.value)} placeholder="Hoặc nhập địa chỉ ví 0x…" className={`${inputCls} max-w-md font-mono`} aria-label="Địa chỉ ví người ký" />
                    <Btn variant="ghost" onClick={() => declare(walletInput.trim())} loading={busy === "declare"} disabled={!walletInput.trim()}>Lưu ví</Btn>
                    {changingWallet && <Btn variant="ghost" onClick={() => { setChangingWallet(false); setError(null) }}>Huỷ</Btn>}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-white">Bước 2: ký bằng ví <span className="font-mono text-xs text-slate-300">{mine.declaredWallet}</span></p>
                  {wrongNetwork && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      Ví đang ở sai mạng. Chữ ký hợp đồng dùng mạng Polygon Amoy.
                      <Btn variant="ghost" onClick={() => run("switch", async () => { await switchToAmoy(wrongNetwork); setWrongNetwork(null) })} loading={busy === "switch"}>Chuyển sang Polygon Amoy</Btn>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {hasWallet() && <Btn onClick={() => sign("injected")} loading={busy === "sign-injected"}><Wallet className="h-4 w-4" />Ký bằng ví trình duyệt</Btn>}
                    {walletConnectEnabled() && <Btn variant={hasWallet() ? "ghost" : "primary"} onClick={() => sign("walletconnect")} loading={busy === "sign-walletconnect"}><Smartphone className="h-4 w-4" />Ký bằng ví điện thoại (QR)</Btn>}
                    <Btn variant="ghost" onClick={() => { setChangingWallet(true); setWalletInput(""); setError(null); setInfo(null) }}>Đổi ví khai báo</Btn>
                    {walletConnectEnabled() && <Btn variant="ghost" onClick={() => run("wc-reset", async () => { await disconnectWalletConnect(); setInfo("Đã ngắt ví điện thoại. Bấm ký lại để quét QR bằng ví khác.") })} loading={busy === "wc-reset"}>Đổi ví điện thoại</Btn>}
                  </div>
                  {info && <p className="text-xs text-cyan-300" role="status">{info}</p>}
                  {!hasWallet() && !walletConnectEnabled() && <p className="text-xs text-amber-300">Trình duyệt chưa có ví. Mở trang này trong trình duyệt có ví đã khai báo (VD: trình duyệt trong app MetaMask), hoặc ký bằng OTP.</p>}
                </div>
              )}
            </div>
          )}

          {method === "otp" && (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-slate-400">Dành cho người không dùng ví. Mã 6 số gửi tới email tài khoản của bạn, có hiệu lực 10 phút.</p>
              <Btn variant={otpSentTo ? "ghost" : "primary"} onClick={sendOtp} loading={busy === "otp-send"}>{otpSentTo ? "Gửi lại mã" : "Gửi mã tới email"}</Btn>
              {otpSentTo && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-300">Đã gửi mã tới {otpSentTo}.</p>
                  <div className="flex flex-wrap gap-2">
                    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Mã 6 số" className={`${inputCls} w-36 font-mono tracking-widest`} aria-label="Mã OTP" />
                    <Btn onClick={verifyOtp} loading={busy === "otp-verify"} disabled={code.length !== 6}>Xác nhận và ký</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!finished && mine.signed && <p className="mt-4 text-sm text-slate-300">Bạn đã ký. Đang chờ bên còn lại ký.</p>}
      <div className="mt-3"><ErrorNote message={error} /></div>
    </Panel>
  )
}
