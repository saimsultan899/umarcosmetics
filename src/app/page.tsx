import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedAuthUser } from "@/lib/supabase/session";

export default async function HomePage() {
  const supabase = await createClient();
  const user = await getVerifiedAuthUser(supabase);

  redirect(user ? "/select-company" : "/login");
}
