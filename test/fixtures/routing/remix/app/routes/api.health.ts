// A resource route: no default export, so no page — just an endpoint.
export async function loader() {
  return new Response('ok');
}
