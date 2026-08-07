import { VoucherDetail } from "../../_shared/voucher-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VoucherDetail id={id} expectedType="JV" title="Journal Voucher" />;
}
