export interface SidebarNavItem {
  id: number;
  label: string;
  href: string;
  permissionKey: string;
  featureKey?: string;
  group:
    | 'Overview'
    | 'People & Apps'
    | 'Academics'
    | 'Operations & Finance'
    | 'Campus Services'
    | 'Communication & Governance';
}

export const SIDEBAR_NAV_ITEMS: SidebarNavItem[] = [
  { id: 1, label: 'Dashboard', href: '/dashboard', permissionKey: 'dashboard', group: 'Overview' },
  { id: 2, label: 'Admissions', href: '/dashboard/admissions', permissionKey: 'admissions', group: 'People & Apps' },
  { id: 3, label: 'Students', href: '/dashboard/students', permissionKey: 'students', group: 'People & Apps' },
  { id: 4, label: 'Parents / Guardians', href: '/dashboard/parents', permissionKey: 'parents', group: 'People & Apps' },
  { id: 5, label: 'Teachers & Staff', href: '/dashboard/staff', permissionKey: 'staff', group: 'People & Apps' },
  { id: 6, label: 'Teacher App Access', href: '/dashboard/app-access/teachers', permissionKey: 'app_access', featureKey: 'teacher_app', group: 'People & Apps' },
  { id: 7, label: 'Student App Access', href: '/dashboard/app-access/students', permissionKey: 'app_access', featureKey: 'student_app', group: 'People & Apps' },
  { id: 32, label: 'Guardian App Access', href: '/dashboard/app-access/guardians', permissionKey: 'app_access', featureKey: 'student_app', group: 'People & Apps' },
  { id: 8, label: 'Mobile App Overview', href: '/dashboard/app-access/overview', permissionKey: 'app_access', group: 'People & Apps' },
  { id: 9, label: 'Academic Sessions', href: '/dashboard/academics/sessions', permissionKey: 'academics', group: 'Academics' },
  { id: 10, label: 'Classes & Sections', href: '/dashboard/academics/classes', permissionKey: 'academics', group: 'Academics' },
  { id: 11, label: 'Subjects', href: '/dashboard/academics/subjects', permissionKey: 'academics', group: 'Academics' },
  { id: 34, label: 'Teacher Class Assign', href: '/dashboard/academics/teacher-assignments', permissionKey: 'academics', group: 'Academics' },
  { id: 12, label: 'Attendance', href: '/dashboard/attendance', permissionKey: 'attendance', group: 'Academics' },
  { id: 31, label: 'Leave Requests', href: '/dashboard/leave-requests', permissionKey: 'attendance', group: 'Academics' },
  { id: 13, label: 'Fees & Finance', href: '/dashboard/fees', permissionKey: 'fees', group: 'Operations & Finance' },
  { id: 14, label: 'Payroll', href: '/dashboard/payroll', permissionKey: 'payroll', featureKey: 'payroll', group: 'Operations & Finance' },
  { id: 15, label: 'Exams & Results', href: '/dashboard/exams', permissionKey: 'exams', group: 'Academics' },
  { id: 16, label: 'Daily Homework', href: '/dashboard/homework', permissionKey: 'homework', group: 'Academics' },
  { id: 17, label: 'Timetable', href: '/dashboard/timetable', permissionKey: 'timetable', group: 'Academics' },
  { id: 18, label: 'Online Classes', href: '/dashboard/online-classes', permissionKey: 'online_classes', featureKey: 'online_classes', group: 'Academics' },
  { id: 19, label: 'Library', href: '/dashboard/library', permissionKey: 'library', featureKey: 'library', group: 'Campus Services' },
  { id: 20, label: 'Transport', href: '/dashboard/transport', permissionKey: 'transport', featureKey: 'transport', group: 'Campus Services' },
  { id: 21, label: 'Inventory', href: '/dashboard/inventory', permissionKey: 'inventory', featureKey: 'inventory', group: 'Campus Services' },
  { id: 22, label: 'Certificates', href: '/dashboard/certificates', permissionKey: 'certificates', group: 'Campus Services' },
  { id: 23, label: 'Announcements', href: '/dashboard/announcements', permissionKey: 'communication', group: 'Communication & Governance' },
  { id: 24, label: 'Notifications', href: '/dashboard/notifications', permissionKey: 'communication', group: 'Communication & Governance' },
  { id: 33, label: 'Complaints', href: '/dashboard/complaints', permissionKey: 'communication', group: 'Communication & Governance' },
  { id: 25, label: 'Reports & Analytics', href: '/dashboard/reports', permissionKey: 'reports', group: 'Operations & Finance' },
  { id: 26, label: 'Roles & Permissions', href: '/dashboard/roles', permissionKey: 'roles', group: 'Communication & Governance' },
  { id: 27, label: 'Audit Logs', href: '/dashboard/audit-logs', permissionKey: 'audit_logs', group: 'Communication & Governance' },
  { id: 28, label: 'My Subscription', href: '/dashboard/subscription', permissionKey: 'subscription', group: 'Communication & Governance' },
  { id: 29, label: 'Help & Support', href: '/dashboard/support', permissionKey: 'support', group: 'Communication & Governance' },
  { id: 30, label: 'School Settings', href: '/dashboard/settings', permissionKey: 'settings', group: 'Communication & Governance' },
];
