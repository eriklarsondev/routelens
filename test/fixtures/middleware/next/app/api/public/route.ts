import { auth } from '@/auth';

export async function POST() {
  const session = await auth();
  if (!session) return new Response(null, { status: 401 });
  return Response.json({});
}
