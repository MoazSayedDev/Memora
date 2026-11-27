import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import type { AttachmentStorage } from './attachment-storage.interface';

@Injectable()
export class LocalAttachmentStorageService
  implements AttachmentStorage, OnModuleInit
{
  private readonly rootDirectory: string;

  constructor(configService: ConfigService) {
    this.rootDirectory = resolve(
      process.cwd(),
      configService.get<string>('UPLOADS_DIR') ?? 'uploads',
    );
  }

  async onModuleInit() {
    const temporaryDirectory = join(this.rootDirectory, '.tmp');
    await mkdir(temporaryDirectory, { recursive: true });
    const staleFiles = await readdir(temporaryDirectory);
    await Promise.all(
      staleFiles.map((filename) =>
        rm(join(temporaryDirectory, filename), {
          recursive: true,
          force: true,
        }),
      ),
    );
  }

  async storeTempFile(tempPath: string, storageKey: string) {
    const destination = this.getFilePath(storageKey);
    await mkdir(this.rootDirectory, { recursive: true });
    await rename(tempPath, destination);
  }

  getFilePath(storageKey: string) {
    if (!storageKey || storageKey !== storageKey.split(/[\\/]/).at(-1)) {
      throw new Error('Invalid attachment storage key');
    }
    const filePath = resolve(this.rootDirectory, storageKey);
    if (!filePath.startsWith(`${this.rootDirectory}${sep}`)) {
      throw new Error('Invalid attachment storage key');
    }
    return filePath;
  }

  async delete(storageKey: string) {
    try {
      await rm(this.getFilePath(storageKey));
      return true;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return false;
      }
      throw error;
    }
  }

  async deleteTempFile(tempPath: string) {
    const temporaryDirectory = join(this.rootDirectory, '.tmp');
    const absoluteTempPath = resolve(tempPath);
    if (!absoluteTempPath.startsWith(`${temporaryDirectory}${sep}`)) {
      throw new Error('Invalid temporary attachment path');
    }
    try {
      await rm(absoluteTempPath);
    } catch (error) {
      if (!this.isMissingFile(error)) {
        throw error;
      }
    }
  }

  async openReadStream(storageKey: string) {
    const file = await open(this.getFilePath(storageKey), 'r');
    return file.createReadStream();
  }

  async stageDelete(storageKey: string) {
    const stagingToken = randomUUID();
    const stagingDirectory = join(this.rootDirectory, '.trash');
    await mkdir(stagingDirectory, { recursive: true });
    try {
      await rename(
        this.getFilePath(storageKey),
        join(stagingDirectory, `${stagingToken}.trash`),
      );
      return stagingToken;
    } catch (error) {
      if (this.isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  async restoreStagedFile(storageKey: string, stagingToken: string) {
    await rename(
      this.getStagedFilePath(stagingToken),
      this.getFilePath(storageKey),
    );
  }

  async finalizeStagedDelete(stagingToken: string) {
    try {
      await rm(this.getStagedFilePath(stagingToken));
    } catch (error) {
      if (!this.isMissingFile(error)) {
        throw error;
      }
    }
  }

  private isMissingFile(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }

  private getStagedFilePath(stagingToken: string) {
    if (!/^[0-9a-f-]{36}$/.test(stagingToken)) {
      throw new Error('Invalid attachment deletion token');
    }
    return join(this.rootDirectory, '.trash', `${stagingToken}.trash`);
  }
}
