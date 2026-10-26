import { assetContentType, readAsset, type AssetKind } from './dashboard.js';

export interface LensResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Headers every answer carries: never cached, never sniffed into another type.
 * JSON adds `Cross-Origin-Resource-Policy`, so no other site can even load it.
 */
const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function html(body: string): LensResponse {
  return {
    status: 200,
    headers: { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
    body,
  };
}

/** One of the dashboard's two built files. */
export function asset(kind: AssetKind): LensResponse {
  return { status: 200, headers: { ...BASE_HEADERS, 'content-type': assetContentType(kind) }, body: readAsset(kind) };
}

export function json(status: number, payload: unknown): LensResponse {
  return {
    status,
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      'cross-origin-resource-policy': 'same-origin',
    },
    body: JSON.stringify(payload),
  };
}

export function text(status: number, body: string): LensResponse {
  return { status, headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' }, body };
}
