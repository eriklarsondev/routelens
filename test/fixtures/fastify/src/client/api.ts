const BASE = '/api/v2';

/** Generic wrapper: the real endpoint is only known at runtime. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init);
  return response.json();
}

export function listItems() {
  return fetch('/api/v2/items');
}
