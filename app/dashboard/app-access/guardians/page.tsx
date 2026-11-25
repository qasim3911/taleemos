'use client';

import { AppAccessManager } from '@/components/dashboard/app-access-manager';

export default function GuardianAppAccessPage() {
  return (
    <AppAccessManager
      targetType="guardian"
      title="Guardian App Access"
      subtitle="Manage Guardian Login inside the Universal Student App. Generate QR codes, reset PINs, and link multiple authorized children without a separate Parent App."
    />
  );
}
