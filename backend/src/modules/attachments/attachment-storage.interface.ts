import type { ReadStream } from 'node:fs';

export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

export interface AttachmentStorage {
  storeTempFile(tempPath: string, storageKey: string): Promise<void>;
  getFilePath(storageKey: string): string;
  openReadStream(storageKey: string): Promise<ReadStream>;
  stageDelete(storageKey: string): Promise<string | null>;
  restoreStagedFile(storageKey: string, stagingToken: string): Promise<void>;
  finalizeStagedDelete(stagingToken: string): Promise<void>;
  delete(storageKey: string): Promise<boolean>;
  deleteTempFile(tempPath: string): Promise<void>;
}
