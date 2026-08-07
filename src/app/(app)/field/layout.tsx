import { FieldMobileNav } from "@/components/field/mobile-nav";

export default function FieldLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full pb-24 md:pb-0">
      {children}
      <FieldMobileNav />
    </div>
  );
}
