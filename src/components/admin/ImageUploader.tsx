'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { IMAGE_ACCEPT, MAX_IMAGE_LABEL, checkImageFile } from '@/lib/images/config';
import { resolveImageUrl } from '@/lib/images/url';

export type UploadFolder = 'restaurants' | 'menu-items' | 'events';

type Status = 'idle' | 'uploading' | 'success' | 'error';

interface Props {
  label: string;
  /** Stored reference: a bucket object path, a /public path, or a legacy URL. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Reports every object this uploader creates, so the parent can clean up. */
  onUploaded?: (path: string) => void;
  folder: UploadFolder;
  /** Entity id, or "new" while the record does not exist yet. */
  owner?: string;
  hint?: string;
  aspect?: 'wide' | 'square';
  disabled?: boolean;
}

/**
 * Admin image picker: click or drag-and-drop, validate, upload, preview,
 * replace, remove.
 *
 * The file goes to `/api/admin/images`, which re-checks it and writes to
 * Supabase Storage with the service-role key. No key and no direct storage
 * call ever exists in the browser — this component only ever posts a file.
 */
export function ImageUploader({
  label,
  value,
  onChange,
  onUploaded,
  folder,
  owner = 'new',
  hint,
  aspect = 'wide',
  disabled,
}: Props) {
  const inputId = useId();
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Release the object URL created for the optimistic preview.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const remoteUrl = resolveImageUrl(value);
  const preview = localPreview ?? remoteUrl;

  function reset() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setLocalPreview(null);
  }

  function upload(file: File) {
    setError(null);

    const check = checkImageFile(file);
    if (!check.ok) {
      setStatus('error');
      setError(check.error);
      return;
    }

    // Show the picked file immediately; swap to the stored URL once it lands.
    reset();
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setLocalPreview(objectUrl);

    setStatus('uploading');
    setProgress(0);

    const body = new FormData();
    body.append('file', file);
    body.append('folder', folder);
    body.append('owner', owner);

    // XHR rather than fetch: it reports real upload progress.
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/images');
    request.responseType = 'json';

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener('load', () => {
      const payload = request.response as { path?: string; error?: string } | null;

      if (request.status >= 200 && request.status < 300 && payload?.path) {
        setStatus('success');
        setProgress(100);
        onChange(payload.path);
        onUploaded?.(payload.path);
        reset();
        return;
      }

      setStatus('error');
      setError(payload?.error ?? 'Upload failed. Please try again.');
      reset();
    });

    request.addEventListener('error', () => {
      setStatus('error');
      setError('Upload failed. Please check your connection and try again.');
      reset();
    });

    request.send(body);
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) upload(file);
  }

  function remove() {
    reset();
    setStatus('idle');
    setProgress(0);
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const busy = status === 'uploading' || disabled;

  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold text-ink-700">{label}</span>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={IMAGE_ACCEPT}
        disabled={busy}
        className="sr-only"
        aria-describedby={statusId}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {preview ? (
        /* ------------------------------------------------ preview + actions */
        <div className="overflow-hidden rounded-xl border border-sand-300 bg-white">
          <div
            className={cn(
              'relative bg-sand-100',
              aspect === 'wide' ? 'aspect-[16/10]' : 'aspect-square',
            )}
          >
            <Image
              src={preview}
              alt={`${label} preview`}
              fill
              sizes="(max-width: 768px) 100vw, 480px"
              className="object-cover"
              unoptimized={preview.startsWith('blob:')}
            />

            {status === 'uploading' && (
              <div className="absolute inset-0 grid place-items-center bg-ink-900/55 text-white">
                <div className="w-2/3 max-w-56 space-y-2 text-center">
                  <p className="text-sm font-semibold">Uploading… {progress}%</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-sand-200 bg-sand-50 px-3 py-2.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Change image
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={remove}>
              Remove
            </Button>
            {status === 'success' && (
              <span className="ml-auto text-xs font-semibold text-brand-700">
                <span aria-hidden="true">✓</span> Uploaded
              </span>
            )}
          </div>
        </div>
      ) : (
        /* ------------------------------------------------------- drop zone */
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
            dragging
              ? 'border-brand-500 bg-brand-50'
              : 'border-sand-300 bg-sand-50 hover:border-brand-400 hover:bg-brand-50/50',
            busy && 'cursor-not-allowed opacity-60',
            status === 'error' && 'border-red-400 bg-red-50',
          )}
        >
          <span aria-hidden="true" className="text-2xl">
            {status === 'uploading' ? '⏳' : '📷'}
          </span>
          <span className="text-sm font-semibold text-ink-800">
            {status === 'uploading' ? `Uploading… ${progress}%` : `Upload ${label.toLowerCase()}`}
          </span>
          <span className="text-xs text-ink-500">
            Click or drag &amp; drop · JPG, PNG or WebP · Max {MAX_IMAGE_LABEL}
          </span>
          <span className="mt-1 inline-flex h-8 items-center rounded-full border border-sand-300 bg-white px-3 text-xs font-semibold text-ink-700">
            Choose image
          </span>
        </button>
      )}

      {/* Announced politely; errors carry an icon and text, never colour alone. */}
      <p id={statusId} role="status" aria-live="polite" className="min-h-4 text-xs">
        {error ? (
          <span className="font-semibold text-red-700">
            <span aria-hidden="true">⚠ </span>
            {error}
          </span>
        ) : hint ? (
          <span className="text-ink-500">{hint}</span>
        ) : null}
      </p>
    </div>
  );
}
