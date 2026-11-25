import { redirect } from 'next/navigation';
import { getSchoolContext } from '@/lib/auth/school-context';
import { getStudentPortalContext } from '@/lib/auth/student-context';
import { getTeacherPortalContext } from '@/lib/auth/teacher-context';
import { SchoolContextProvider } from '@/components/dashboard/school-context-provider';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getSchoolContext();

  if (result.status === 'unconfigured') {
    redirect('/login?setup=pending');
  }
  if (result.status === 'unauthenticated') {
    redirect('/login');
  }
  if (result.status === 'no_school') {
    const [teacherCheck, studentCheck] = await Promise.all([
      getTeacherPortalContext(),
      getStudentPortalContext(),
    ]);
    if (teacherCheck.status === 'ok' || teacherCheck.status === 'access_disabled') {
      redirect('/teacher-portal');
    }
    if (studentCheck.status === 'ok' || studentCheck.status === 'access_disabled') {
      redirect('/student-portal');
    }
    redirect('/register');
  }
  if (result.status === 'not_approved' || result.status === 'inactive_member') {
    redirect(`/status?tracking=${encodeURIComponent(result.school.tracking_number || result.school.id)}`);
  }

  return (
    <SchoolContextProvider value={result.context}>
      <DashboardShell>{children}</DashboardShell>
    </SchoolContextProvider>
  );
}
