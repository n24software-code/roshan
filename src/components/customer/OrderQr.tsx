'use client';

import { useEffect, useState } from 'react';

/**
 * Renders the order number as a QR code for the pickup counter.
 * Generated in the browser so nothing extra has to be stored server-side.
 */
export function OrderQr({ orderNumber, caption }: { orderNumber: string; caption: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    import('qrcode')
      .then((qrcode) =>
        qrcode.toDataURL(orderNumber, {
          width: 320,
          margin: 1,
          color: { dark: '#0d3a2c', light: '#ffffff' },
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // QR is a convenience; the printed order number remains authoritative.
      });

    return () => {
      cancelled = true;
    };
  }, [orderNumber]);

  if (!dataUrl) return null;

  return (
    <figure className="flex flex-col items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt={`QR code for order ${orderNumber}`}
        width={160}
        height={160}
        className="rounded-xl border border-sand-200 bg-white p-2"
      />
      <figcaption className="text-xs text-ink-500">{caption}</figcaption>
    </figure>
  );
}
