export const BASE_URL = import.meta.env.VITE_API_URL || '';

// The one place the app calls fetch: the URL is a parameter, so there is
// nothing to read here. The calls below are where the endpoints are.
export function makeJsonRequest(url: string, method: string, body?: unknown) {
  return fetch(url, { method, body: JSON.stringify(body) });
}

export function request(method: string, url: string) {
  return fetch(url, { method });
}

export const client = {
  send: (url: string, init: { method: string }) => fetch(url, init),
};
