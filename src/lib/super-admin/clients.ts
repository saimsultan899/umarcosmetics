import type { AppRole } from "@/lib/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ClientListItem = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  organization_id: string | null;
  banned: boolean;
  created_at: string;
  company_count: number;
  companies: Array<{
    id: string;
    name: string;
    role: AppRole;
    is_active: boolean;
  }>;
};

export async function listClients(): Promise<ClientListItem[]> {
  const admin = createAdminClient();
  const supabase = await createClient();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, organization_id, created_at, is_super_admin")
    .eq("is_super_admin", false)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = profiles || [];
  if (!rows.length) return [];

  const ids = rows.map((p) => p.id);
  const { data: members } = await supabase
    .from("company_members")
    .select("user_id, role, is_active, companies(id, name)")
    .in("user_id", ids);

  const byUser = new Map<
    string,
    Array<{ id: string; name: string; role: AppRole; is_active: boolean }>
  >();

  for (const m of members || []) {
    const company = m.companies as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
    const c = Array.isArray(company) ? company[0] : company;
    if (!c) continue;
    const list = byUser.get(m.user_id) || [];
    list.push({
      id: c.id,
      name: c.name,
      role: m.role as AppRole,
      is_active: Boolean(m.is_active),
    });
    byUser.set(m.user_id, list);
  }

  const authUsers = new Map<
    string,
    { email: string; banned: boolean }
  >();

  // Paginate auth users (admin API)
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error: listError } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (listError) throw new Error(listError.message);
    for (const u of data.users) {
      authUsers.set(u.id, {
        email: u.email || "",
        banned: Boolean(u.banned_until),
      });
    }
    if (data.users.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }

  return rows.map((p) => {
    const auth = authUsers.get(p.id);
    const companies = byUser.get(p.id) || [];
    return {
      id: p.id,
      email: auth?.email || "",
      full_name: p.full_name,
      phone: p.phone,
      organization_id: p.organization_id,
      banned: auth?.banned || false,
      created_at: p.created_at,
      company_count: companies.filter((c) => c.is_active).length,
      companies,
    };
  });
}

export async function createClientUser(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  organizationId?: string | null;
  companyIds?: string[];
  role?: AppRole;
}) {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const fullName = input.fullName.trim();

  if (!email || !password || password.length < 8) {
    throw new Error("Email and password (min 8 chars) are required");
  }
  if (!fullName) throw new Error("Full name is required");

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created.user) {
    throw new Error(createError?.message || "Failed to create user");
  }

  const userId = created.user.id;
  const role: AppRole = input.role || "org_admin";

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: fullName,
      phone: input.phone?.trim() || null,
      organization_id: input.organizationId || null,
      is_super_admin: false,
    })
    .eq("id", userId);

  if (profileError) {
    // Best-effort cleanup
    await admin.auth.admin.deleteUser(userId);
    throw new Error(profileError.message);
  }

  const companyIds = input.companyIds || [];
  for (const companyId of companyIds) {
    const { error: memError } = await admin.from("company_members").upsert(
      {
        company_id: companyId,
        user_id: userId,
        role,
        is_active: true,
      },
      { onConflict: "company_id,user_id" },
    );
    if (memError) {
      throw new Error(memError.message);
    }
  }

  return {
    id: userId,
    email,
    password,
    full_name: fullName,
  };
}

export async function provisionTenant(input: {
  organizationName: string;
  organizationStatus?: "active" | "suspended";
  companies: Array<{
    name: string;
    code?: string;
    city?: string;
    address?: string;
    phone?: string;
    ntn?: string;
    warehouse?: string;
  }>;
  client: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  };
}) {
  const admin = createAdminClient();
  const orgName = input.organizationName.trim();
  if (!orgName) throw new Error("Organization name is required");
  if (!input.companies.length) throw new Error("Add at least one company");

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: orgName,
      status: input.organizationStatus === "suspended" ? "suspended" : "active",
    })
    .select("*")
    .single();

  if (orgError || !org) throw new Error(orgError?.message || "Org create failed");

  const companyIds: string[] = [];
  const createdCompanies: Array<{ id: string; name: string }> = [];

  for (const c of input.companies) {
    const name = c.name.trim();
    if (!name) throw new Error("Company name is required");

    const { data: company, error: companyError } = await admin
      .from("companies")
      .insert({
        organization_id: org.id,
        name,
        code: c.code?.trim() || null,
        city: c.city?.trim() || null,
        address: c.address?.trim() || null,
        phone: c.phone?.trim() || null,
        ntn: c.ntn?.trim() || null,
        is_active: true,
      })
      .select("*")
      .single();

    if (companyError || !company) {
      throw new Error(companyError?.message || "Company create failed");
    }

    const wh = (c.warehouse || "MAIN").trim() || "MAIN";
    const code = wh.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "MAIN";
    const { error: whError } = await admin.from("warehouses").insert({
      organization_id: org.id,
      company_id: company.id,
      name: wh,
      code,
    });
    if (whError) throw new Error(whError.message);

    companyIds.push(company.id);
    createdCompanies.push({ id: company.id, name: company.name });
  }

  const client = await createClientUser({
    email: input.client.email,
    password: input.client.password,
    fullName: input.client.fullName,
    phone: input.client.phone,
    organizationId: org.id,
    companyIds,
    role: "org_admin",
  });

  return {
    organization: { id: org.id, name: org.name },
    companies: createdCompanies,
    client,
  };
}
