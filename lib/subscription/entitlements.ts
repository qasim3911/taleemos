import type {
  SchoolEntitlements,
  SchoolSubscriptionRecord,
  SubscriptionPlanRecord,
} from '@/lib/types/database';

const ALL_MODULE_FEATURES = [
  'teacher_app',
  'student_app',
  'payroll',
  'online_classes',
  'library',
  'transport',
  'inventory',
];

function mapPlanFeaturesToKeys(_plan?: SubscriptionPlanRecord | null): string[] {
  return ALL_MODULE_FEATURES;
}

export function resolveEntitlements(
  subscription: (SchoolSubscriptionRecord & { plan?: SubscriptionPlanRecord | null }) | null,
  usage: { students: number; teachers: number; storageMb: number }
): SchoolEntitlements {
  if (!subscription || !subscription.plan) {
    return {
      planName: 'Starter',
      planCategory: 'Free',
      subscriptionStatus: 'Active',
      billingPeriod: 'Monthly',
      startDate: null,
      expiryDate: null,
      maxStudents: 0,
      maxTeachers: 0,
      maxStorageMb: 0,
      currentStudents: usage.students,
      currentTeachers: usage.teachers,
      currentStorageMb: usage.storageMb,
      enabledFeatures: ALL_MODULE_FEATURES,
      disabledFeatures: [],
      isRestricted: false,
      restrictionReason: null,
    };
  }

  const plan = subscription.plan;
  const maxStudents = subscription.student_limit_override ?? plan.student_limit ?? 0;
  const maxTeachers = subscription.teacher_limit_override ?? plan.teacher_limit ?? 0;
  const maxStorageMb = subscription.storage_limit_override_mb ?? plan.storage_limit_mb ?? 0;

  const rawStart = subscription.starts_at ?? subscription.start_date ?? null;
  const rawExpiry = subscription.expires_at ?? subscription.expiry_date ?? null;
  const billingPeriod = subscription.billing_cycle ?? subscription.billing_period ?? 'monthly';

  const startDate = rawStart ? String(rawStart).slice(0, 10) : null;
  const expiryDate = rawExpiry ? String(rawExpiry).slice(0, 10) : null;

  const today = new Date().toISOString().slice(0, 10);
  const isExpiredByDate = Boolean(expiryDate && expiryDate < today);
  const statusLower = String(subscription.status || '').toLowerCase();
  const isRestricted = statusLower === 'suspended';

  let restrictionReason: string | null = null;
  if (statusLower === 'suspended') {
    restrictionReason =
      'School subscription is currently suspended by Super Admin. Historical records remain safe; write actions are restricted until reactivated.';
  }

  const displayStatus =
    isExpiredByDate && statusLower === 'active'
      ? 'Expired'
      : subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1);

  return {
    planName: plan.name,
    planCategory: plan.code ? plan.code.charAt(0).toUpperCase() + plan.code.slice(1) : 'Plan',
    subscriptionStatus: displayStatus,
    billingPeriod: billingPeriod.charAt(0).toUpperCase() + billingPeriod.slice(1),
    startDate,
    expiryDate,
    maxStudents,
    maxTeachers,
    maxStorageMb,
    currentStudents: usage.students,
    currentTeachers: usage.teachers,
    currentStorageMb: usage.storageMb,
    enabledFeatures: mapPlanFeaturesToKeys(plan),
    disabledFeatures: [],
    isRestricted,
    restrictionReason,
  };
}

export function canAddStudent(entitlements: SchoolEntitlements): { allowed: boolean; reason?: string } {
  if (entitlements.isRestricted) {
    return { allowed: false, reason: entitlements.restrictionReason || 'Subscription restricted.' };
  }
  if (entitlements.maxStudents > 0 && entitlements.currentStudents >= entitlements.maxStudents) {
    return {
      allowed: false,
      reason: `Student limit reached (${entitlements.currentStudents}/${entitlements.maxStudents}). Upgrade your plan in My Subscription.`,
    };
  }
  return { allowed: true };
}

export function canAddTeacher(entitlements: SchoolEntitlements): { allowed: boolean; reason?: string } {
  if (entitlements.isRestricted) {
    return { allowed: false, reason: entitlements.restrictionReason || 'Subscription restricted.' };
  }
  if (entitlements.maxTeachers > 0 && entitlements.currentTeachers >= entitlements.maxTeachers) {
    return {
      allowed: false,
      reason: `Teacher limit reached (${entitlements.currentTeachers}/${entitlements.maxTeachers}). Upgrade your plan in My Subscription.`,
    };
  }
  return { allowed: true };
}

export function isFeatureEntitled(_entitlements: SchoolEntitlements, _featureKey?: string): boolean {
  return true;
}
