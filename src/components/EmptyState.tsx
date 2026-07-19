export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}
