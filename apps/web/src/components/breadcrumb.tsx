"use client";

import { createContext, useContext, useEffect } from "react";

export interface Crumb {
  label: string;
  href?: string;
}

// The app-shell owns the header; pages push their breadcrumb trail up to it.
export const BreadcrumbSetter = createContext<((crumbs: Crumb[]) => void) | null>(null);

/** Set the shell header breadcrumb for as long as this component is mounted. */
export function useBreadcrumb(crumbs: Crumb[]) {
  const set = useContext(BreadcrumbSetter);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set?.(crumbs);
    return () => set?.([]);
    // key captures the crumbs content; `crumbs`/`set` are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
