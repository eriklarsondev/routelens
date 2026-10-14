import Link from 'next/link';

export function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      {/* Lands on a next.config redirect, which is somewhere to land. */}
      <Link href="/old-home">Old home</Link>
      <Link href="/pricing">Pricing</Link>
    </nav>
  );
}
