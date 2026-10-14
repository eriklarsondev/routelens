import { requireUserId } from '~/session.server';

export async function loader({ request }) {
  await requireUserId(request);
  return null;
}

export default function Dashboard() {
  return <main>dashboard</main>;
}
