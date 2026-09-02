import { getLocaleContext } from '@/lib/i18n/server';
import { VerifyFlow } from '@/components/customer/VerifyFlow';

export const dynamic = 'force-dynamic';

export default async function VerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale, t } = await getLocaleContext(params);

  return (
    <div className="container-page max-w-md py-12 md:py-20">
      <div className="card-surface p-6 md:p-8">
        <VerifyFlow locale={locale} />
      </div>
      <p className="mt-6 text-center text-xs text-ink-400">{t('details.privacy')}</p>
    </div>
  );
}
