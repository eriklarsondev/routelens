import { requireUserId } from '~/session.server';

export const loader = async ({ request, params }) => {
  const userId = await requireUserId(request);
  return getNote({ id: params.noteId, userId });
};

export default function Note() {
  return <main>note</main>;
}
