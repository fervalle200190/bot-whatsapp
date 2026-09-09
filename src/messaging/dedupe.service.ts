import { Injectable } from '@nestjs/common';

const DEFAULT_TTL_MS = 5 * 60_000;

/** Descarte de eventos repetidos por `messageId`, en memoria con TTL corto (Meta reintenta en minutos, no en días). */
@Injectable()
export class DedupeService {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs = DEFAULT_TTL_MS;

  /** Chequea y marca en una sola operación síncrona, para que no haya ventana de carrera entre requests concurrentes. */
  shouldProcess(messageId: string): boolean {
    this.cleanup();
    if (this.seen.has(messageId)) return false;
    this.seen.set(messageId, Date.now());
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, seenAt] of this.seen) {
      if (now - seenAt > this.ttlMs) this.seen.delete(id);
    }
  }
}
