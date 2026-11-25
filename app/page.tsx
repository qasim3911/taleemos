import Link from 'next/link';
import Image from 'next/image';
import { PublicHeader } from '@/components/public/public-header';
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CreditCard,
  FileCheck2,
  Phone,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';

export const metadata = {
  title: 'TaleemOS — School Management Platform Pakistan',
  description: 'Manage admissions, bilingual student profiles, QR attendance, PKR fee vouchers, staff payroll, examinations, and mobile app access from one verified school portal.',
};

const CAPABILITIES = [
  {
    title: 'Admissions & Student Records',
    description:
      'English and Urdu student profiles, B-Form tracking, webcam photo capture, promotions, transfers, and instant PDF ID cards.',
    icon: Users,
  },
  {
    title: 'Fees, Payroll & Accounts',
    description:
      'Monthly fee challans, JazzCash, Easypaisa, bank and cash receipts, attendance-linked staff payroll, and downloadable salary slips.',
    icon: CreditCard,
  },
  {
    title: 'Academics, Attendance & Exams',
    description:
      'Punjab and Federal Board structures, QR Gate IN/OUT attendance, date sheets, marks entry, and publication-gated report cards.',
    icon: BookOpenCheck,
  },
  {
    title: 'Teacher & Student App Access',
    description:
      'Provision, invite, enable, block, or deactivate access for the separate Teacher and Student Android apps with backend enforcement.',
    icon: Smartphone,
  },
  {
    title: 'Timetable & Online Classes',
    description:
      'Class and teacher schedules, academic holidays, and live virtual classrooms powered by dedicated video infrastructure.',
    icon: CalendarClock,
  },
  {
    title: 'Certificates & Multi-Tenant Security',
    description:
      'School Leaving, Character, and Bonafide PDFs alongside strict school-level data isolation and role-based staff permissions.',
    icon: FileCheck2,
  },
];

const STEPS = [
  {
    step: 'Step 01',
    title: 'Submit School Application',
    description: 'Receive an instant tracking number and Pending review status.',
  },
  {
    step: 'Step 02',
    title: 'Super Admin Verification',
    description: 'Platform administrators verify campus credentials and activate your plan.',
  },
  {
    step: 'Step 03',
    title: 'Provision Staff & Students',
    description: 'Configure classes, fee structures, and invite mobile app accounts.',
  },
  {
    step: 'Step 04',
    title: 'Real-Time Synchronization',
    description: 'Attendance, homework, and published exam results sync live across devices.',
  },
];

export default function SchoolWelcomePage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <PublicHeader />

      <main>
        <section className="mx-auto max-w-7xl px-6 py-12 lg:py-20">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-stretch">
            <div className="flex flex-col justify-between lg:col-span-6 space-y-6">
              <div className="space-y-4">
                <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                  Pakistan Multi-School SaaS Portal · Punjab & Federal Boards
                </p>
                <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
                  Centralized operations for modern Pakistani schools
                </h1>
                <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300 max-w-xl">
                  Manage admissions, bilingual student profiles, QR attendance, PKR fee vouchers,
                  staff payroll, examinations, and mobile app access from one verified school portal.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0"
                >
                  Register Your School
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  School Login
                </Link>
              </div>

              {/* Founder Contact - Hero */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">Founded by Qasim Raza</span>
                <span className="text-slate-400">·</span>
                <a href="tel:+923218890307" className="font-semibold text-teal-700 dark:text-teal-400 hover:underline">
                  For Support Call / WhatsApp: 0321-8890307
                </a>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 sm:h-96 lg:h-full min-h-[320px] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-200 dark:bg-slate-900">
                <Image
                  src="/images/pakistan_school_campus.jpg"
                  alt="Modern Pakistani private school campus courtyard"
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent p-6">
                  <p className="text-xs font-medium text-teal-300">
                    Dedicated School Portal · Separate Mobile Apps · Super Admin Governance
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    Every record is scoped strictly to your school_id and protected by row-level security.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 border-t border-slate-200 dark:border-slate-800 pt-8">
            {STEPS.map((item) => (
              <div
                key={item.step}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5"
              >
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.step}</p>
                <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="capabilities"
          className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 py-16"
        >
          <div className="mx-auto max-w-7xl px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                Platform Modules
              </p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white [text-wrap:balance]">
                30 integrated school modules built for daily administration
              </h2>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 p-6"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-white">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="mobile-access" className="border-t border-slate-200 dark:border-slate-800 py-16">
          <div className="mx-auto max-w-7xl px-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
              <div className="flex items-center gap-3 text-teal-700 dark:text-teal-400">
                <ShieldCheck className="h-5 w-5" />
                <span className="text-xs font-semibold">Universal Teacher App Governance</span>
              </div>
              <h3 className="mt-3 font-display text-xl font-bold text-slate-900 dark:text-white">
                Provision, invite, and control teacher mobile access
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Send password setup links without duplicating authentication accounts. Disabling or
                blocking a teacher rejects mobile API access immediately while preserving every past
                attendance and exam record.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
              <div className="flex items-center gap-3 text-teal-700 dark:text-teal-400">
                <Building2 className="h-5 w-5" />
                <span className="text-xs font-semibold">Universal Student App Governance</span>
              </div>
              <h3 className="mt-3 font-display text-xl font-bold text-slate-900 dark:text-white">
                Student-only portal synchronization with strict privacy
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Enable Student App access only when a verified student email identity is available.
                Students view exclusively their own attendance, fee challans, homework, and
                published exam results.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 py-10">
        <div className="mx-auto max-w-7xl px-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6 flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="text-center sm:text-left">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Contact Us / Rabta Karein</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Founder: <span className="font-bold text-slate-900 dark:text-white">Qasim Raza</span></p>
              <p className="text-sm text-slate-600 dark:text-slate-300">Phone: <span className="font-bold text-teal-700 dark:text-teal-400">0321-8890307</span></p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <a href="tel:+923218890307" className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white">
                <Phone className="h-4 w-4" /> Call Now
              </a>
              <a href="https://wa.me/923218890307" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2.5 text-sm font-semibold text-white">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            </div>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 px-6 text-xs text-slate-500 dark:text-slate-400">
            <p>TaleemOS School Management Platform · Multi-Tenant SaaS Pakistan · Founder: Qasim Raza · 0321-8890307</p>
          </div>
        </div>
      </footer>
    </div>
  );
}