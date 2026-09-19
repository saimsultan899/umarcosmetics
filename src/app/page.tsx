import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedAuthUser } from "@/lib/supabase/session";
import { cookies } from "next/headers";
import {
  decodeOfflineShell,
  OFFLINE_OK_COOKIE,
  OFFLINE_SHELL_COOKIE,
} from "@/lib/offline/offline-shell";

export default async function HomePage() {
  const jar = await cookies();
  const shellRaw = jar.get(OFFLINE_SHELL_COOKIE)?.value;
  const isOfflineOk = jar.get(OFFLINE_OK_COOKIE)?.value === "1";

  if (shellRaw && isOfflineOk) {
    const shell = decodeOfflineShell(shellRaw);
    if (shell?.activeCompanyId) {
      redirect("/dashboard");
    }
    if (shell) {
      redirect("/select-company");
    }
  }

  let user = null;
  try {
    const supabase = await createClient();
    user = await Promise.race([
      getVerifiedAuthUser(supabase),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    user = null;
  }

  redirect(user ? "/select-company" : "/login");
}
