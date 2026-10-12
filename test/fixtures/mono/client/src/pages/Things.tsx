import api from '@/services/api';

export function Things() {
  const load = () => api.get('/things');
  const create = () => api.post('/things');
  const remove = (id: string) => api.delete(`/things/${id}`);
  return { load, create, remove };
}
