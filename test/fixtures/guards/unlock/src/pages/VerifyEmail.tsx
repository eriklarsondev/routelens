import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getMe, verifyEmail } from '../api';

export default function VerifyEmail() {
  const { id, token } = useParams<{ id: string; token: string }>();
  useEffect(() => {
    verifyEmail(id, token).then(() => getMe());
  }, [id, token]);
  return <main>verifying…</main>;
}
