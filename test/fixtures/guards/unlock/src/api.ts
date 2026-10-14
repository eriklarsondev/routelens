import axios from 'axios';

export function verifyEmail(id: string, token: string) {
  return axios.patch(`/api/email/${id}/verify/${token}`);
}

export function getMe() {
  return axios.get('/api/me');
}
