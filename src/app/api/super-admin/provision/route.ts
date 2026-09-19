import {
  isNextResponse,
  requireSuperAdminApi,
} from "@/lib/super-admin/guard";
import { provisionTenant } from "@/lib/super-admin/clients";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  try {
    const body = (await request.json()) as {
      organizationName?: string;
      organizationStatus?: "active" | "suspended";
      companies?: Array<{
        name: string;
        code?: string;
        city?: string;
        address?: string;
        phone?: string;
        ntn?: string;
        warehouse?: string;
      }>;
      client?: {
        email: string;
        password: string;
        fullName: string;
        phone?: string;
      };
    };

    if (!body.client) {
      return NextResponse.json({ error: "Client details required" }, { status: 400 });
    }

    const result = await provisionTenant({
      organizationName: body.organizationName || "",
      organizationStatus: body.organizationStatus,
      companies: body.companies || [],
      client: body.client,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provision failed" },
      { status: 400 },
    );
  }
}
