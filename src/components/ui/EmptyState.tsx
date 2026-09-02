export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="card-surface flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-brand-400">{icon}</div>}
      <h3 className="text-lg font-semibold text-ink-800">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
