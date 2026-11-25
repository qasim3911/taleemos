import { AppAccessManager } from '@/components/dashboard/app-access-manager';

export default function TeacherAppAccessPage() {
  return (
    <AppAccessManager
      targetType="teacher"
      title="Teacher App Access"
      subtitle="Provision, invite, enable, block, or deactivate Teacher Android App access without deleting historical school records."
    />
  );
}
