'use client';

import React, { createContext, useContext } from 'react';
import type { SchoolContextData } from '@/lib/types/database';

const SchoolContext = createContext<SchoolContextData | null>(null);

export function SchoolContextProvider({
  value,
  children,
}: {
  value: SchoolContextData;
  children: React.ReactNode;
}) {
  return <SchoolContext.Provider value={value}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
  const ctx = useContext(SchoolContext);
  if (!ctx) {
    throw new Error('useSchool must be used within SchoolContextProvider');
  }
  return ctx;
}
