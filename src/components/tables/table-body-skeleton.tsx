import { Skeleton } from "@/components/ui/page-skeleton";
import { cn } from "@/lib/utils";

export function TableBodySkeleton({
  rows = 8,
  cols = 6,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className={cn("animate-pulse", className)} aria-hidden>
          {Array.from({ length: cols }).map((__, col) => (
            <td key={col} className="py-3">
              <Skeleton className="h-4 w-full max-w-[10rem]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
