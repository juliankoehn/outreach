"use client";

import { createContext, useContext } from "react";
import type { Account } from "@/lib/accounts";

interface AccountCtx {
  id: string;
  account: Account;
}

const Ctx = createContext<AccountCtx | null>(null);

export function AccountProvider({ value, children }: { value: AccountCtx; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccount must be used inside AccountProvider");
  return ctx;
}
