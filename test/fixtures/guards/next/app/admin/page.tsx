import { forbidden } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

export default async function Admin() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== 'admin') forbidden();
  return <main>admin</main>;
}
