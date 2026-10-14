import { withAuth } from '@/lib/auth';

export const GET = withAuth(async (req: Request) => {
  return Response.json({ ok: true });
});

export const POST = async (req: Request) => {
  return Response.json({ ok: true });
};
