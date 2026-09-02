'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveSettings } from '@/lib/admin/actions';
import { Toggle } from './AdminForm';
import { Button } from '@/components/ui/Button';
import { useToast } from './Toaster';

export function SettingsForm({ soundEnabled }: { soundEnabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [sound, setSound] = useState(soundEnabled);

  function save() {
    startTransition(async () => {
      const result = await saveSettings({ sound_notifications: sound });
      if (!result.ok) {
        toast({ title: 'Could not save settings', body: result.error, tone: 'error' });
        return;
      }
      toast({ title: 'Settings saved', tone: 'success' });
      router.refresh();
    });
  }

  return (
    <div className="card-surface max-w-2xl p-6">
      <h2 className="text-lg font-extrabold text-ink-900">Notifications</h2>
      <p className="mt-1 text-sm text-ink-500">
        New orders always appear on screen in real time. The sound is optional.
      </p>

      <div className="mt-5">
        <Toggle checked={sound} onChange={setSound} label="Play a sound when a new order arrives" />
      </div>

      <div className="mt-6">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </div>
  );
}
