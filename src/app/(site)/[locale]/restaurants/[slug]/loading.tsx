import { Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div>
      <Skeleton className="h-56 w-full rounded-none md:h-72" />
      <div className="container-page py-8">
        <Skeleton className="h-12 w-full rounded-full" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-36 w-full rounded-[1.25rem]" />
          ))}
        </div>
      </div>
    </div>
  );
}
