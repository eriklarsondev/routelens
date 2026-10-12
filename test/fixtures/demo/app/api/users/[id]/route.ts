export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return Response.json({ id: params.id });
}

export const DELETE = async () => new Response(null, { status: 204 });
