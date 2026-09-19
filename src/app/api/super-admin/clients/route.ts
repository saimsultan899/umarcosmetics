import {
  isNextResponse,
  requireSuperAdminApi,
} from "@/lib/super-admin/guard";
import { createClientUser, listClients } from "@/lib/super-admin/clients";
import { NextResponse } from "next/server";

export async function GET() {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list clients" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      fullName?: string;
      phone?: string;
      organizationId?: string;
      companyIds?: string[];
      role?: string;
    };

    const created = await createClientUser({
      email: body.email || "",
      password: body.password || "",
      fullName: body.fullName || "",
      phone: body.phone,
      organizationId: body.organizationId,
      companyIds: body.companyIds,
      role: (body.role as "org_admin") || "org_admin",
    });

    return NextResponse.json({ client: created });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create client" },
      { status: 400 },
    );
  }
}
