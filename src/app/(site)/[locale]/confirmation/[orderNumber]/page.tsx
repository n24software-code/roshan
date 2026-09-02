import { getLocaleContext } from '@/lib/i18n/server';
import { OrderConfirmation } from '@/components/customer/OrderConfirmation';

export const dynamic = 'force-dynamic';

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderNumber: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { locale } = await getLocaleContext(params as Promise<{ locale: string }>);
  const { orderNumber } = await params;
  const { duplicate } = await searchParams;

  return (
    <div className="container-page max-w-lg py-10 md:py-16">
      <OrderConfirmation
        locale={locale}
        orderNumber={decodeURIComponent(orderNumber)}
        duplicate={duplicate === '1'}
      />
    </div>
  );
}
