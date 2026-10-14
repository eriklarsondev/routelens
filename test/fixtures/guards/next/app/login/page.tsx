import { redirect } from 'next/navigation';
import { auth } from '@/auth';

// Someone already signed in is sent on, not turned away.
export default async function Login() {
  const session = await auth();
  if (session) redirect('/dashboard');
  return <form />;
}
