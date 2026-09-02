import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import '@/app/globals.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-montserrat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  robots: { index: false, follow: false },
};

/** The admin area is English-only and always left-to-right. */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={montserrat.variable}>
      <body className="min-h-dvh bg-sand-100 text-ink-800">{children}</body>
    </html>
  );
}
