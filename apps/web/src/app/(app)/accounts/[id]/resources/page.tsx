import { use } from "react";
import { ResourcesTab } from "./resources-tab";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ResourcesTab accountId={id} />;
}
