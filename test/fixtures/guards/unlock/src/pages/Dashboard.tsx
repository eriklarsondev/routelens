import { getMe } from '../api';

export default function Dashboard() {
  getMe();
  return <main>dashboard</main>;
}
