import { notFound } from 'next/navigation';
import { getUser } from '@/db';

// A missing record is a 404, not a gate.
export default async function User({ params }: { params: { id: string } }) {
  const user = await getUser(params.id);
  if (!user) notFound();
  return <main>{user.name}</main>;
}
