import { redirect } from 'next/navigation';

export default function Dashboard() {
  redirect('/dashboard/hr/daily-summary');
}
