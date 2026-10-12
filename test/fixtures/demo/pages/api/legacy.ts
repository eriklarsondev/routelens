export default function handler(req: any, res: any) {
  if (req.method === 'GET') return res.json({ ok: true });
  if (req.method === 'PUT') return res.status(200).end();
  return res.status(405).end();
}
