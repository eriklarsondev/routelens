import { isIP } from 'node:net';

/**
 * Who may read the dashboard. It maps every endpoint in the app and can open
 * files in the developer's editor, so it answers the developer's own browser
 * and nothing else — the protections Vite and webpack-dev-server added for the
 * same kind of local endpoint.
 */

/** A request's headers with lowercased names, as Node and `Headers` both give them. */
export type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Whether a `Host` header names this machine or the developer's own network.
 *
 * DNS rebinding points an attacker's domain at 127.0.0.1, after which their page
 * can read anything the dev server answers — but the browser still sends their
 * domain as the Host. A real dev server is reached as `localhost`, by a private
 * IP address, or by a single-label name (a Docker service, a hosts-file entry),
 * none of which an attacker's DNS can serve. Any other name, and a public IP,
 * needs listing in `allowedHosts`. This guards browsers; a client that is not
 * one can send any Host it likes, which is why `/open` also checks the socket.
 */
export function isAllowedHost(host: string | undefined, allowedHosts: readonly string[] | true = []): boolean {
  if (allowedHosts === true) return true;
  const name = hostname(host);
  if (!name) return false;

  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (isIP(name)) return isLocalAddress(name);
  if (!name.includes('.')) return true;

  return allowedHosts.some((allowed) => {
    const entry = allowed.trim().toLowerCase().replace(/\.$/, '');
    // `.example.com` allows example.com and every subdomain, as in Vite.
    return entry.startsWith('.') ? name === entry.slice(1) || name.endsWith(entry) : name === entry;
  });
}

/** `[::1]:3000` → `::1`; `LocalHost.:80` → `localhost`. */
export function hostname(host: string | undefined): string | null {
  const value = host?.trim().toLowerCase();
  if (!value) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1]!;
  // An IPv6 address without brackets has no port to strip.
  if (isIP(value) === 6) return value;
  const name = value.replace(/:\d+$/, '').replace(/\.$/, '');
  return name || null;
}

/** Loopback, private, link-local, CGNAT (Tailscale) and unspecified addresses. */
export function isLocalAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) ||
      ip === '0.0.0.0'
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

/**
 * Whether a browser sent this request from another site's page. Such a page can
 * neither read the scan nor make routelens open an editor: the browser says
 * where a request came from in `Sec-Fetch-Site`, and in `Origin` when it is too
 * old for that. A request with neither did not come from a page at all.
 */
export function isCrossSite(headers: RequestHeaders): boolean {
  const site = first(headers['sec-fetch-site']);
  if (site) return site !== 'same-origin' && site !== 'none';

  const origin = first(headers.origin);
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // `Origin: null` — a sandboxed frame or a file — is never the dashboard.
    return true;
  }
  // Behind a proxy that rewrites Host, the browser's view is the forwarded one.
  const hosts = [hostOf(headers), first(headers['x-forwarded-host'])?.split(',')[0]?.trim()];
  return !hosts.some((host) => host && host.toLowerCase() === originHost.toLowerCase());
}

/**
 * Whether the request came from the machine the server runs on: over loopback,
 * or to the server's own LAN address from that same address. Only then can the
 * editor routelens opens be in front of the person who asked.
 */
export function isSameMachine(remoteAddress: string | undefined, localAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const remote = remoteAddress.replace(/^::ffff:/i, '');
  if (remote === '::1' || remote.startsWith('127.')) return true;
  return localAddress !== undefined && remote === localAddress.replace(/^::ffff:/i, '');
}

/** The host a request names: `Host`, or `:authority` over HTTP/2, which Vite serves when it serves HTTPS. */
export function hostOf(headers: RequestHeaders): string | undefined {
  return first(headers.host) ?? first(headers[':authority']);
}

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
