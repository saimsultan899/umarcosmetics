import { VoucherDetail } from "../../_shared/voucher-detail";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = sp.print === "1" || sp.print === "true";
  return (
    <VoucherDetail
      id={id}
      expectedType="JV"
      title="Journal Voucher"
      autoPrint={autoPrint}
    />
  );
}
