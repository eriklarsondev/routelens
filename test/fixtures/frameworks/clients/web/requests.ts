import got from 'got';
import ky from 'ky';

export const kyList = () => ky.get('/api/ky-items').json();
export const kyCreate = () => ky('/api/ky-items', { method: 'post', json: {} });

export const gotOne = (id: string) => got(`/api/got-items/${id}`);
export const gotRemove = (id: string) => got.delete(`/api/got-items/${id}`);

export const socket = () => new WebSocket('ws://localhost:3000/api/socket');
export const stream = () => new EventSource('/api/stream');
