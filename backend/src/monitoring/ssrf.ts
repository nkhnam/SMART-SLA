import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

type ResolvedAddress = { address: string; family: 4 | 6 };
type Ipv6Groups = [number, number, number, number, number, number, number, number];

export function validateEndpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Endpoint must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Endpoint must use HTTP or HTTPS.");
  if (!url.hostname || url.username || url.password) throw new TypeError("Endpoint URL must not contain credentials.");
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new TypeError("Endpoint must use the standard HTTP or HTTPS port.");
  if (isRestrictedHostname(url.hostname)) throw new TypeError("Endpoint hostname is not publicly routable.");
  if (isIP(url.hostname) && !isPublicAddress(url.hostname)) throw new TypeError("Endpoint address is not publicly routable.");
  url.hash = "";
  return url;
}

export async function resolvePublicAddress(
  url: URL,
  lookup: typeof dnsLookup = dnsLookup
): Promise<ResolvedAddress> {
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily as 4 | 6 }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new TypeError("Endpoint resolves to a restricted network address.");
  }
  const first = addresses[0];
  if (!first) throw new TypeError("Endpoint has no public network address.");
  return { address: first.address, family: first.family as 4 | 6 };
}

export function validateRedirectUrl(current: URL, location: string): URL {
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new TypeError("Endpoint redirect URL is invalid.");
  }
  if (current.protocol === "https:" && next.protocol !== "https:") throw new TypeError("Endpoint redirects cannot downgrade HTTPS.");
  return validateEndpointUrl(next.toString());
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const groups = parseIpv6(address);
  if (!groups) return false;
  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0, seventh = 0, eighth = 0] = groups;
  if ([first, second, third, fourth, fifth].every((group) => group === 0) && sixth === 0xffff) {
    const mapped = `${seventh >> 8}.${seventh & 255}.${eighth >> 8}.${eighth & 255}`;
    return isPublicIpv4(mapped);
  }
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001 && second <= 0x01ff) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && (second & 0xfff0) === 0) return false;
  return true;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  const third = octets[2] ?? -1;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 0 || second === 2 || (second === 88 && third === 99) || second === 168)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51 && third === 100)) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  return true;
}

function parseIpv6(address: string): number[] | null {
  const input = address.toLowerCase();
  if (input.includes("%")) return null;
  let normalized = input;
  const dottedAddress = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dottedAddress) {
    const octets = dottedAddress.split(".").map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const left = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const right = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    normalized = normalized.replace(dottedAddress, `${left}:${right}`);
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((group) => /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : -1);
  return groups.length === 8 && groups.every((group) => group >= 0) ? groups as Ipv6Groups : null;
}

function isRestrictedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized === "metadata.google.internal"
    || normalized === "metadata.azure.internal"
    || normalized === "instance-data.ec2.internal";
}
