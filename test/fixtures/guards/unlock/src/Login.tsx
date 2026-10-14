export default function Login() {
  const submit = () => fetch('/api/auth/login', { method: 'POST' });
  return <button onClick={submit}>Sign in</button>;
}
