import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase-server";

/** Route gate (§35 server-side authorization).
 *  - Supabase unconfigured → demo access (any role via query param).
 *  - No session → /signin. */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const client = await getServerClient();
  if (client) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) redirect("/signin");
  }
  return <>{children}</>;
}
