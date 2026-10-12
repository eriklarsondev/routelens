import axios from 'axios';
import useSWR from 'swr';

export function useUsers() {
  return useSWR('/api/users', (key: string) => fetch(key).then((r) => r.json()));
}

export async function createUser(name: string) {
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return response.json();
}

export async function getUser(id: string) {
  const { data } = await axios.get(`/api/users/${id}`);
  return data;
}

export async function removeUser(id: string) {
  await fetch(`/api/users/${id}`, { method: 'DELETE' });
}

export async function charge() {
  return fetch('/api/v1/billing/charge', { method: 'POST' });
}

// This endpoint does not exist on the server any more.
export async function brokenCall() {
  return fetch('/api/usres', { method: 'GET' });
}

export async function stars() {
  const res = await fetch('https://api.github.com/repos/vercel/next.js');
  return res.json();
}
