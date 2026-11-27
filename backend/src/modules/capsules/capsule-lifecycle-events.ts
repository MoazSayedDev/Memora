import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

@Injectable()
export class CapsuleLifecycleEvents extends EventEmitter {
  capsuleClosed(capsuleId: string, closedAt: Date) {
    this.emit('capsule.closed', { capsuleId, closedAt });
  }

  capsuleOpened(capsuleId: string, openedAt: Date) {
    this.emit('capsule.opened', { capsuleId, openedAt });
  }
}
