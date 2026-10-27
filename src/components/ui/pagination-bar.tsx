import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationBarProps {
  /** Zero-based page index. */
  page: number;
  pageSize: number;
  /** Total rows matching the current filter, not the rows on this page. */
  total: number;
  onPageChange: (page: number) => void;
  /** Plural noun shown to the user, e.g. "transaksi". */
  label: string;
}

/**
 * Footer for a server-paged table.
 *
 * The row range is derived from the *server* total, so the count stays honest
 * when a page is partially filled or the filter changes.
 */
export function PaginationBar({ page, pageSize, total, onPageChange, label }: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {total === 0 ? `0 ${label}` : `${first}-${last} dari ${total} ${label}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          <ChevronLeft className="w-4 h-4" />
          Sebelumnya
        </Button>
        <span className="text-sm text-muted-foreground">
          Halaman {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Berikutnya
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
