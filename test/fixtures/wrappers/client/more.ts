import axios from 'axios';
import { BASE_URL, makeJsonRequest } from './core';

const api = axios.create();
const BASE_PATH = import.meta.env.BASE_URL;

// Built first, sent a few lines later: the call it reaches says what it is.
export async function archiveItem(id: string) {
  const url = `${BASE_URL}/api/items/${id}/archive?force=1`;
  console.log('archiving', url);
  return fetch(url, { method: 'POST' });
}

// A query string kept in a variable and glued on the end.
export function reportSummary(id: string, qs: string) {
  const url = `${BASE_URL}/api/reports/${id}/summary${qs}`;
  return makeJsonRequest(url, 'GET');
}

// An origin assembled from several pieces.
export function openLive(proto: string) {
  const socketUrl = `${proto}://${window.location.host}${BASE_PATH}/api/live`;
  return new WebSocket(socketUrl);
}

// TypeScript type arguments between the method and the call.
export const featured = () => api.get<{ items: string[] }>('/api/items/featured');

export function follow() {
  const stream = `${BASE_URL}/api/events`;
  return new EventSource(stream);
}

// A query whose expression holds a template of its own.
export function exportReports(qs: string) {
  const url = `${BASE_URL}/api/reports/export${qs ? `?${qs}` : ''}`;
  return fetch(url);
}

// The same, passed straight to the call.
export const archivedReports = (qs: string) =>
  makeJsonRequest(`${BASE_URL}/api/reports/archived${qs ? `?${qs}` : ''}`, 'GET');

// Fits /api/stats/daily and /api/stats/weekly equally well: crediting either
// would be a guess.
export const stats = (period: string, suffix: string) =>
  makeJsonRequest(`${BASE_URL}/api/stats/${period}${suffix}`, 'GET');
