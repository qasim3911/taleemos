'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { SIDEBAR_NAV_ITEMS } from '@/lib/navigation/sidebar-items';
import { isFeatureEntitled } from '@/lib/subscription/entitlements';
import { useSchool } from './school-context-provider';
import { useTheme } from '@/components/providers/theme-provider';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  AlertTriangle,
  Bell,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Sun,
  X,
} from 'lucide-react';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { school, member, entitlements } = useSchool();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navQuery, setNavQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingLeavesCount, setPendingLeavesCount] = useState(0);
  const [openComplaintsCount, setOpenComplaintsCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;

    const loadCounters = async () => {
      const [{ count }, leavesRes, complaintsRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('school_id', school.id)
          .eq('is_read', false),
        fetch('/api/leaves', { cache: 'no-store' }).catch(() => null),
        fetch('/api/complaints', { cache: 'no-store' }).catch(() => null),
      ]);
      if (!active) return;
      setUnreadCount(count ?? 0);
      if (leavesRes && leavesRes.ok) {
        const leaveData = await leavesRes.json().catch(() => null);
        if (active && leaveData?.summary && typeof leaveData.summary.pending === 'number') {
          setPendingLeavesCount(leaveData.summary.pending);
        }
      }
      if (complaintsRes && complaintsRes.ok) {
        const compData = await complaintsRes.json().catch(() => null);
        if (active && compData?.summary && typeof compData.summary.open === 'number') {
          setOpenComplaintsCount(compData.summary.open);
        }
      }
    };

    queueMicrotask(() => {
      void loadCounters();
    });

    const channel = supabase
      .channel(`school-notifications-${school.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadCounters();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'staff_leave_records',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadCounters();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leave_requests',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadCounters();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'complaints',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadCounters();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_tickets',
          filter: `school_id=eq.${school.id}`,
        },
        () => {
          void loadCounters();
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [school.id]);

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    window.location.assign('/login');
  };

  // NEW: Refresh Button ka kaam
  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    window.location.reload();
  };

  const visibleItems = useMemo(() => {
    return SIDEBAR_NAV_ITEMS.filter((item) => {
      const hasPerm =
        member.role_name === 'School Owner' ||
        member.role_name === 'Owner' ||
        Boolean(member.permissions?.['*']) ||
        Boolean(member.permissions?.[item.permissionKey]);
      if (!hasPerm) return false;
      if (item.href === '/dashboard/subscription' || item.href === '/dashboard/support') {
        return true;
      }
      if (!isFeatureEntitled(entitlements, item.featureKey)) return false;
      if (navQuery.trim()) {
        return item.label.toLowerCase().includes(navQuery.toLowerCase());
      }
      return true;
    });
  }, [member, entitlements, navQuery]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, typeof visibleItems>();
    for (const item of visibleItems) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return Array.from(groups.entries());
  }, [visibleItems]);

  const currentNav = SIDEBAR_NAV_ITEMS.find((item) => item.href === pathname);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
        />
      )}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-68 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {school.logo_url ? (
              <img
                src={school.logo_url}
                alt={school.name_en}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">
                {school.name_en.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold text-slate-900 dark:text-white">
                {school.name_en}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {school.city} · {entitlements.planName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={navQuery}
              onChange={(e) => setNavQuery(e.target.value)}
              placeholder="Filter modules..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-800 dark:text-slate-200 focus:border-teal-600 focus:outline-none"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
          {groupedItems.map(([groupName, items]) => (
            <div key={groupName}>
              <p className="px-2.5 pb-1.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                {groupName}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-teal-700 text-white dark:bg-teal-600'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.href === '/dashboard/leave-requests' && pendingLeavesCount > 0 && (
                        <span
                          className={`ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono-tabular text-[10px] font-bold ${
                            active
                              ? 'bg-white text-teal-800'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          {pendingLeavesCount}
                        </span>
                      )}
                      {item.href === '/dashboard/complaints' && openComplaintsCount > 0 && (
                        <span
                          className={`ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono-tabular text-[10px] font-bold ${
                            active
                              ? 'bg-white text-teal-800'
                              : 'bg-red-600 text-white'
                          }`}
                        >
                          {openComplaintsCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-3">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-600 dark:text-slate-300 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0 text-sm">
              <span className="text-slate-400 dark:text-slate-500">Portal</span>
              <span className="mx-2 text-slate-300 dark:text-slate-700">/</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate">
                {currentNav?.label || 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/dashboard/notifications"
              className="relative rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 font-mono-tabular text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </Link>

            {/* NEW: Chota sa Refresh Button - Bell ke bilkul sath */}
            <button
              type="button"
              onClick={handleRefresh}
              title="Refresh"
              aria-label="Refresh page"
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle light or dark mode"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="hidden sm:block text-right pl-2 border-l border-slate-200 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[160px]">
                {member.full_name}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {member.role_name}
              </p>
            </div>
          </div>
        </header>

        {entitlements.isRestricted && (
          <div className="border-b border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 sm:px-6 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{entitlements.restrictionReason}</span>
            </div>
            <Link
              href="/dashboard/subscription"
              className="font-semibold underline whitespace-nowrap"
            >
              Manage Subscription
            </Link>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 print:p-0 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}