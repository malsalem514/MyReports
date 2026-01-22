'use client';
import React from 'react';
import { ActiveThemeProvider } from '../active-theme';

// Check if Clerk is configured (at build time)
const hasClerkKeys = !!(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== ''
);

export default function Providers({
  activeThemeValue,
  children
}: {
  activeThemeValue: string;
  children: React.ReactNode;
}) {
  // If Clerk is not configured, render without it
  // This is the only path used when no Clerk keys are set
  return (
    <ActiveThemeProvider initialTheme={activeThemeValue}>
      {children}
    </ActiveThemeProvider>
  );
}
