/** Design reference: server-side route — validates session (layout) + resolves role, renders client workspace. */
import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase-server";
import { WorkspacePageClient } from "./workspace-client";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const requested = (await searchParams).role;
  const client = await getServerClient();

  // Demo mode: role comes from the query param.
  if (!client) {
    const role = requested === "advertiser" ? "advertiser" : "creator";
    return <WorkspacePageClient role={role} onExitHref="/" />;
  }

  // Supabase mode: profile role wins; unknown/mismatched role redirects.
  const { data: { user } } = await client.auth.getUser();
  const { data: profile } = await client.from("profiles").select("role").eq("id", user!.id).maybeSingle();
  const role = profile?.role === "advertiser" ? "advertiser" : "creator";
  if (requested && requested !== role) {
    redirect(`/workspace?role=${role}`);
  }
  return <WorkspacePageClient role={role} onExitHref="/" />;
}
