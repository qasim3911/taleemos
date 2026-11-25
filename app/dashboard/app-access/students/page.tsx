import { AppAccessManager } from '@/components/dashboard/app-access-manager';

export default function StudentAppAccessPage() {
  return (
    <AppAccessManager
      targetType="student"
      title="Student App Access"
      subtitle="Control Student-only Android App accounts. Enable access only for students with a verified personal email identity."
    />
  );
}
