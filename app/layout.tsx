import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { ToastProvider } from '@/components/providers/toast-provider';

export const metadata: Metadata = {
  title: 'TaleemOS — School Management Platform',
  description:
    'Multi-tenant School Management Website for Pakistani schools with Student, Staff, Attendance, Fees, Exams, Mobile App Access, and Subscription Governance.',
  openGraph: {
    title: 'TaleemOS — School Management Platform',
    description:
      'Multi-tenant School Management Website for Pakistani schools with Student, Staff, Attendance, Fees, Exams, Mobile App Access, and Subscription Governance.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TaleemOS — School Management Platform',
    description:
      'Multi-tenant School Management Website for Pakistani schools with Student, Staff, Attendance, Fees, Exams, Mobile App Access, and Subscription Governance.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="font-sans antialiased">
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
