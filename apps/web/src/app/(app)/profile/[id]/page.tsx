"use client";

import { use } from "react";
import { ProfileWorkspace } from "./profile-workspace";

export default function ProfileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProfileWorkspace profileId={id} />;
}
