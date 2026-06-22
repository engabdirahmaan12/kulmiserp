import type { Metadata } from 'next';
import { RemindersContent } from '@/components/reminders/RemindersContent';

export const metadata: Metadata = {
  title: 'Reminders & Alerts',
};

export default function RemindersPage() {
  return <RemindersContent />;
}
