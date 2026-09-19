import { redirect } from "next/navigation";

export default async function ExpiryClaimsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  q.set("tab", "claims");

  for (const [key, val] of Object.entries(sp)) {
    if (key !== "tab" && typeof val === "string") {
      q.set(key, val);
    }
  }

  redirect(`/inventory/expiry?${q.toString()}`);
}
