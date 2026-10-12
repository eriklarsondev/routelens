// A suite's hardcoded URLs are neither endpoints the app serves nor requests
// the app makes. Nothing in here should reach the dashboard.
export async function hitGhostEndpoint() {
  return fetch('/api/ghost-endpoint-from-a-test', { method: 'DELETE' });
}
