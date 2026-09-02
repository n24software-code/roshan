import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS, canTransition } from '@/lib/admin/transitions';
import type { OrderStatus } from '@/types/database';

const ALL: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];

describe('order status transitions', () => {
  it('follows the documented lifecycle', () => {
    expect(canTransition('new', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'completed')).toBe(true);
  });

  it('allows cancelling from any open state', () => {
    for (const status of ['new', 'accepted', 'preparing', 'ready'] as OrderStatus[]) {
      expect(canTransition(status, 'cancelled'), status).toBe(true);
    }
  });

  it('treats completed and cancelled as terminal', () => {
    for (const target of ALL) {
      expect(canTransition('completed', target), `completed -> ${target}`).toBe(false);
      expect(canTransition('cancelled', target), `cancelled -> ${target}`).toBe(false);
    }
  });

  it('does not allow skipping ahead or going backwards', () => {
    expect(canTransition('new', 'ready')).toBe(false);
    expect(canTransition('new', 'completed')).toBe(false);
    expect(canTransition('ready', 'preparing')).toBe(false);
    expect(canTransition('accepted', 'new')).toBe(false);
  });

  it('never lets a status transition to itself', () => {
    for (const status of ALL) {
      expect(ALLOWED_TRANSITIONS[status]).not.toContain(status);
    }
  });
});
