import LandingClient from "./landing-client";
import { getServerClient } from "@/lib/supabase-server";

export default async function Home() {
  const client = await getServerClient();
  const user = client ? (await client.auth.getUser()).data.user : null;
  return <LandingClient sessionEmail={user?.email} />;
}
