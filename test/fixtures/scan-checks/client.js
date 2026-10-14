const BASE_URL = process.env.API_ORIGIN;
const STRIPE = process.env.STRIPE_ORIGIN;

export const items = () => fetch(`${BASE_URL}/api/items`);
// Gone from the server, and the origin is an expression.
export const archived = () => fetch(`${BASE_URL}/api/archived-items`);
// Another service's API: nothing here serves /v1.
export const charge = () => fetch(`${STRIPE}/v1/charges`, { method: 'POST' });
