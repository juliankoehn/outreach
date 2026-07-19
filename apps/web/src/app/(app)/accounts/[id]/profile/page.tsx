"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "../account-context";
import { ProfileWorkspace } from "@/app/(app)/profile/[id]/profile-workspace";

// Profiles are per-account: this tab resolves (and creates on first visit) the
// account's own creator profile, then renders the full workspace inline.
export default function AccountProfileTab() {
  const { id } = useAccount();
  const router = useRouter();
  const [profileId, setProfileId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/linkedin/accounts/${id}/profile`, { credentials: "include" });
      if (res.status === 401) return router.push("/login");
      if (res.ok) setProfileId(((await res.json()) as { profile: { id: string } }).profile.id);
    })();
  }, [id, router]);

  if (!profileId) return <Skeleton className="h-64 w-full rounded-xl" />;
  return <ProfileWorkspace profileId={profileId} embedded />;
}
