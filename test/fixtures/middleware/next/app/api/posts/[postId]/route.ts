import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';

// Anyone can read a post.
export async function GET(req: Request, { params }: { params: { postId: string } }) {
  return Response.json(await db.post.find(params.postId));
}

// Only its author can change it, which a helper next to the handler decides.
export async function PATCH(req: Request, { params }: { params: { postId: string } }) {
  if (!(await canEdit(params.postId))) {
    return new Response(null, { status: 403 });
  }
  return Response.json(await db.post.update(params.postId, await req.json()));
}

async function canEdit(postId: string) {
  const session = await getServerSession();
  const post = await db.post.find(postId);
  return post.authorId === session?.user.id;
}
