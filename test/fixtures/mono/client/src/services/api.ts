import axios from 'axios';

const BASE_PATH = import.meta.env.VITE_BASE_PATH || '/app';

// The origin is decided at runtime; the `/api` it is joined to is not.
const api = axios.create({
  baseURL: `${BASE_PATH}/api`,
});

export default api;
