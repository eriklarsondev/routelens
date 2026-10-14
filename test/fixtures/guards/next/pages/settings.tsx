import { getSession } from 'next-auth/react';

export const getServerSideProps = async (context) => {
  const session = await getSession(context);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  return { props: { session } };
};

export default function Settings() {
  return <main>settings</main>;
}
