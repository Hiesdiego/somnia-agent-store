//app/[workspace]/page.tsx

import { notFound } from "next/navigation";
import ProphecyCompanionPage from "../page";

const WORKSPACES = new Set(["analysis", "scout", "autopilot", "runs", "settings"]);

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  if (!WORKSPACES.has(workspace)) notFound();
  return <ProphecyCompanionPage />;
}
