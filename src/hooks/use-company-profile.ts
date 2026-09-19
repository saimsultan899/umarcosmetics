"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { readOfflineShellCookie } from "@/lib/offline/offline-shell";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/lib/types/database";
import { useEffect, useState } from "react";

export type CompanyProfileState = {
  company: Company | null;
  orgCompanies: Company[];
  loading: boolean;
  isOnline: boolean;
};

export function useCompanyProfile({
  initialCompany,
  initialOrgCompanies = [],
  initialOffline = false,
}: {
  initialCompany?: Company | null;
  initialOrgCompanies?: Company[];
  initialOffline?: boolean;
} = {}): CompanyProfileState {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [company, setCompany] = useState<Company | null>(initialCompany || null);
  const [orgCompanies, setOrgCompanies] = useState<Company[]>(initialOrgCompanies);
  const [loading, setLoading] = useState(!initialCompany);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 1. If offline, hydrate from offline shell snapshot
      if (!isOnline) {
        const shell = readOfflineShellCookie();
        if (shell?.company) {
          const c: Company = {
            id: shell.company.id,
            organization_id: shell.company.organization_id,
            name: shell.company.name,
            code: null,
            address: null,
            city: shell.company.city || null,
            phone: null,
            ntn: null,
            logo_url: null,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (!cancelled && !company) setCompany(c);

          const orgComps: Company[] = (shell.memberships || [])
            .filter((m) => m.companies)
            .map((m) => ({
              id: m.companies!.id,
              organization_id: m.companies!.organization_id || shell.company?.organization_id || "",
              name: m.companies!.name,
              code: null,
              address: null,
              city: m.companies!.city || null,
              phone: null,
              ntn: null,
              logo_url: null,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }));
          if (!cancelled && orgCompanies.length === 0) setOrgCompanies(orgComps);
        }
        if (!cancelled) setLoading(false);
        return;
      }

      // 2. If online, fetch from Supabase
      try {
        const supabase = createClient();
        const activeCompId = initialCompany?.id || company?.id;
        if (activeCompId) {
          const { data: compData } = await supabase
            .from("companies")
            .select("*")
            .eq("id", activeCompId)
            .maybeSingle();

          if (!cancelled && compData) {
            setCompany(compData as Company);
            const { data: orgData } = await supabase
              .from("companies")
              .select("*")
              .eq("organization_id", compData.organization_id)
              .eq("is_active", true)
              .order("name");

            if (!cancelled && orgData) {
              setOrgCompanies(orgData as Company[]);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load company profile:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOnline, initialCompany?.id, company?.id]);

  return {
    company,
    orgCompanies,
    loading,
    isOnline,
  };
}
