"use client";

import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" className="no-print" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      {label}
    </Button>
  );
}
