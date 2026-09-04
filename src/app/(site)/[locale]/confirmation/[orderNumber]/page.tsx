import { getLocaleContext } from '@/lib/i18n/server';
import { getMyOrder } from '@/lib/orders/actions';
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

  const requested = decodeURIComponent(orderNumber);

  // The order is read on the server from the caller's verified session, so a
  // guessed order number in the URL reveals nothing about someone else's order.
  const order = await getMyOrder();

  return (
    <div className="container-page max-w-lg py-10 md:py-16">
      <OrderConfirmation
        locale={locale}
        orderNumber={requested}
        duplicate={duplicate === '1'}
        order={order?.order_number === requested ? order : null}
      />
    </div>
  );
}
