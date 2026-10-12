export async function GET() {
  return Response.json([{ id: 1 }]);
}

export async function POST(request: Request) {
  return Response.json(await request.json(), { status: 201 });
}

// export async function DELETE() {} <- commented out, must not be detected
