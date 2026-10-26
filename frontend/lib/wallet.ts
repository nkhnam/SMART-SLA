"use client"

// Ký hợp đồng bằng ví EVM theo chuẩn EIP-1193, 2 cách kết nối:
//   "injected"      : ví tiện ích trên trình duyệt máy tính (MetaMask, OKX, Rabby, Coinbase...)
//   "walletconnect" : ví trên ĐIỆN THOẠI qua mã QR (WalletConnect / Reown) - MetaMask, Trust, OKX mobile...
import { BrowserProvider } from "ethers"

type Eip1193 = { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> }
type WcProvider = Eip1193 & {
  session?: unknown
  accounts: string[]
  chainId: number
  connect: (opts?: { optionalChains?: number[] }) => Promise<void>
  disconnect: () => Promise<void>
}
declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

export type WalletKind = "injected" | "walletconnect"

export const AMOY_CHAIN_ID = "0x13882" // 80002
const AMOY_DEC = 80002
// RPC công cộng ổn định hơn; RPC chính thức của Polygon hay chập chờn nên để dự phòng cuối
const AMOY_RPC = "https://polygon-amoy-bor-rpc.publicnode.com"
const AMOY_RPC_FALLBACKS = [AMOY_RPC, "https://polygon-amoy.drpc.org", "https://rpc-amoy.polygon.technology"]
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ""

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum
}

// Có cấu hình WalletConnect (project id lấy miễn phí tại cloud.reown.com) thì mới hiện nút ví điện thoại
export function walletConnectEnabled() {
  return !!WC_PROJECT_ID
}

// WalletConnect: tải thư viện khi cần (không làm nặng trang)
let wcPromise: Promise<WcProvider> | null = null
function walletConnect(): Promise<WcProvider> {
  if (!WC_PROJECT_ID) return Promise.reject(new Error("Chưa cấu hình WalletConnect (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)."))
  if (!wcPromise) {
    wcPromise = import("@walletconnect/ethereum-provider")
      .then(({ EthereumProvider }) =>
        EthereumProvider.init({
          projectId: WC_PROJECT_ID,
          optionalChains: [AMOY_DEC],
          rpcMap: { [AMOY_DEC]: AMOY_RPC },
          showQrModal: true, // hiện mã QR để quét bằng app ví trên điện thoại
          metadata: {
            name: "SLA-DEX",
            description: "Ký hợp đồng SLA bằng chữ ký điện tử EIP-712",
            url: window.location.origin,
            icons: [],
          },
        }),
      )
      .then((p) => p as unknown as WcProvider)
      .catch((err) => {
        wcPromise = null
        throw err
      })
  }
  return wcPromise
}

function injected(): Eip1193 {
  if (!window.ethereum) throw new Error("Không tìm thấy ví trên trình duyệt. Dùng ví điện thoại (quét QR) hoặc ký bằng mã OTP.")
  return window.ethereum
}

async function providerOf(kind: WalletKind): Promise<Eip1193> {
  if (kind === "injected") return injected()
  const wc = await walletConnect()
  if (!wc.session) await wc.connect({ optionalChains: [AMOY_DEC] }) // hiện QR nếu chưa kết nối
  return wc
}

export async function connectWallet(kind: WalletKind): Promise<string> {
  const p = await providerOf(kind)
  const accounts = kind === "walletconnect" ? (p as WcProvider).accounts : ((await p.request({ method: "eth_requestAccounts" })) as string[])
  if (!accounts?.length) throw new Error("Ví không trả về tài khoản nào")
  return accounts[0]
}

export async function currentChainId(kind: WalletKind): Promise<string> {
  const p = await providerOf(kind)
  if (kind === "walletconnect") return `0x${(p as WcProvider).chainId.toString(16)}`
  return String(await p.request({ method: "eth_chainId" })).toLowerCase()
}

// Chuyển ví sang mạng Polygon Amoy (tự thêm mạng nếu ví chưa có)
export async function switchToAmoy(kind: WalletKind) {
  const p = await providerOf(kind)
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AMOY_CHAIN_ID }] })
  } catch (err) {
    const code = (err as { code?: number })?.code
    if (code !== 4902) {
      if (kind === "walletconnect") {
        throw new Error("Ví điện thoại chưa bật mạng Polygon Amoy. Thêm mạng Polygon Amoy trong app ví, rồi bấm “Đổi ví điện thoại” để kết nối lại.")
      }
      throw err
    }
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: AMOY_CHAIN_ID,
          chainName: "Polygon Amoy Testnet",
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
          rpcUrls: AMOY_RPC_FALLBACKS,
          blockExplorerUrls: ["https://amoy.polygonscan.com"],
        },
      ],
    })
  }
}

// Ký EIP-712 bằng đúng địa chỉ ví đã khai báo (ví điện thoại: mở app ví để xác nhận)
export async function signTypedData(
  kind: WalletKind,
  address: string,
  domain: Record<string, unknown>,
  types: Record<string, { name: string; type: string }[]>,
  message: Record<string, unknown>,
): Promise<string> {
  const provider = new BrowserProvider(await providerOf(kind))
  const signer = await provider.getSigner(address)
  return signer.signTypedData(domain, types, message)
}

// Ngắt kết nối ví điện thoại (để quét QR bằng ví khác)
export async function disconnectWalletConnect() {
  if (!wcPromise) return
  try {
    const wc = await wcPromise
    if (wc.session) await wc.disconnect()
  } catch {
    /* bỏ qua */
  }
}

export function walletErrorMessage(err: unknown): string {
  const e = err as { code?: number | string; shortMessage?: string; message?: string }
  if (e?.code === 4001 || e?.code === "ACTION_REJECTED") return "Bạn đã huỷ thao tác trên ví."
  if (/Connection request reset|User rejected|Modal closed/i.test(e?.message ?? "")) return "Bạn đã đóng mã QR hoặc từ chối kết nối trên ví."
  return e?.shortMessage || e?.message || "Ví báo lỗi không xác định"
}
