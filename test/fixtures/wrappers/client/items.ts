import { BASE_URL, client, makeJsonRequest, request } from './core';

export const listItems = () => makeJsonRequest(`${BASE_URL}/api/items`, 'GET');

export const createItem = (body: unknown) => makeJsonRequest(`${BASE_URL}/api/items`, 'POST', body);

export function updateItem(id: string, body: unknown) {
  return makeJsonRequest(
    `${BASE_URL}/api/items/${id}`,
    'PATCH',
    body,
  );
}

export const deleteItem = (id: string) => request('DELETE', `/api/items/${id}`);

export const loadReports = () => client.send('/api/reports', { method: 'GET' });

// Built here, requested elsewhere: listed, but never accused of anything.
export const ARCHIVE_URL = `${BASE_URL}/api/archive`;

// Moving the browser is a link, not a request.
export function leave(navigate: (to: string) => void, history: { push: (to: string) => void }) {
  navigate('/api/items');
  history.push('/api/reports');
}
