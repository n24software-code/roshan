import { cn } from '@/lib/cn';

/** Shared table chrome so every admin table looks and behaves the same. */
export function TableShell({
  head,
  children,
  empty,
  isEmpty,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: React.ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty) {
    return <div className="card-surface px-6 py-16 text-center">{empty}</div>;
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead className="bg-sand-100 text-left">
            <tr>{head}</tr>
          </thead>
          <tbody className="divide-y divide-sand-200">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-xs font-bold tracking-[0.08em] text-ink-500 uppercase whitespace-nowrap',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...props} className={cn('px-4 py-3 align-middle text-ink-700', className)}>
      {children}
    </td>
  );
}
