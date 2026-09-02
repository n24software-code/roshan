import Link from 'next/link';
import { buttonClass } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-20 text-center">
      <div className="space-y-4">
        <p className="numeric text-5xl font-extrabold text-brand-700">404</p>
        <h1 className="text-2xl font-bold text-ink-900">Page not found</h1>
        <Link href="/" className={buttonClass('primary', 'md')}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
