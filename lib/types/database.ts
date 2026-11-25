export type ApplicationStatus =
  | 'Pending'
  | 'Under Review'
  | 'Approved'
  | 'Active'
  | 'Rejected'
  | 'On Hold'
  | 'Suspended'
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'active'
  | 'rejected'
  | 'on_hold'
  | 'suspended';

export type AppAccountStatus =
  | 'not_provisioned'
  | 'pending_invite'
  | 'active'
  | 'blocked'
  | 'deactivated';

export type BillingPeriod = 'Monthly' | 'Quarterly' | '6 Months' | 'Yearly' | 'monthly' | 'yearly';

export interface SchoolRecord {
  id: string;
  owner_user_id: string;
  name_en: string;
  name_ur: string | null;
  school_type: string;
  registration_number: string;
  bise_peira_number: string | null;
  principal_name: string;
  owner_name: string;
  email: string;
  mobile_number: string;
  address: string;
  province: string;
  district: string;
  tehsil: string;
  logo_url: string | null;
  status: string;
  application_status: string | null;
  created_at: string;
  updated_at: string;
  activated_at?: string | null;
  approved_at?: string | null;
  suspended_at?: string | null;
  rejected_at?: string | null;
  // Normalized display aliases populated in getSchoolContext
  city: string;
  phone: string;
  board_type: string;
  tracking_number: string;
  status_reason: string | null;
}

export interface SubscriptionPlanRecord {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  price_monthly_pkr: number;
  price_yearly_pkr: number;
  student_limit: number;
  teacher_limit: number;
  storage_limit_mb: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface SchoolSubscriptionRecord {
  id: string;
  school_id: string;
  plan_id: string;
  status: string;
  billing_cycle?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  requested_plan_id?: string | null;
  renewal_requested_at?: string | null;
  // Optional legacy/override compatibility fields
  billing_period?: string | null;
  start_date?: string | null;
  expiry_date?: string | null;
  student_limit_override?: number | null;
  teacher_limit_override?: number | null;
  storage_limit_override_mb?: number | null;
  plan?: SubscriptionPlanRecord | null;
}

export interface SchoolMemberRecord {
  id: string;
  school_id: string;
  user_id: string;
  role_name: string;
  full_name: string;
  email: string;
  permissions: Record<string, boolean>;
  is_active: boolean;
}

export interface SchoolEntitlements {
  planName: string;
  planCategory: string;
  subscriptionStatus: string;
  billingPeriod: string;
  startDate: string | null;
  expiryDate: string | null;
  maxStudents: number;
  maxTeachers: number;
  maxStorageMb: number;
  currentStudents: number;
  currentTeachers: number;
  currentStorageMb: number;
  enabledFeatures: string[];
  disabledFeatures: string[];
  isRestricted: boolean;
  restrictionReason: string | null;
}

export interface SchoolContextData {
  configured: boolean;
  userId: string;
  userEmail: string;
  school: SchoolRecord;
  member: SchoolMemberRecord;
  subscription: SchoolSubscriptionRecord | null;
  entitlements: SchoolEntitlements;
}
