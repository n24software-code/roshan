import Image from 'next/image';
import { cn } from '@/lib/cn';
import { resolveImageUrl } from '@/lib/images/url';

type Kind = 'restaurant' | 'item' | 'event';

const PLACEHOLDER_GLYPH: Record<Kind, string> = {
  restaurant: '🍽',
  item: '🍽',
  event: '◈',
};

/**
 * Renders a stored image reference, falling back to a styled placeholder when
 * there is no image.
 *
 * Every image in the application goes through here so the reference format
 * (storage object, /public file, or legacy URL) is resolved in one place, and a
 * missing picture never produces a broken-image icon or a collapsed layout.
 */
export function MediaImage({
  reference,
  alt,
  kind = 'item',
  sizes,
  priority,
  className,
  imageClassName,
  rounded,
}: {
  reference: string | null | undefined;
  /** Empty string marks the image as decorative when the name is already nearby. */
  alt: string;
  kind?: Kind;
  sizes?: string;
  priority?: boolean;
  className?: string;
  imageClassName?: string;
  rounded?: string;
}) {
  const src = resolveImageUrl(reference);

  if (!src) {
    return (
      <div
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn(
          'pattern-geometric grid h-full w-full place-items-center bg-sand-100',
          rounded,
          className,
        )}
      >
        <span aria-hidden="true" className="text-2xl opacity-30 grayscale">
          {PLACEHOLDER_GLYPH[kind]}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes ?? '(max-width: 768px) 100vw, 33vw'}
      priority={priority}
      loading={priority ? undefined : 'lazy'}
      className={cn('object-cover', imageClassName, className)}
    />
  );
}
