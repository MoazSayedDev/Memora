import { BadRequestException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertFileSignature,
  getAttachmentFilePolicy,
} from '../../../src/modules/attachments/file-validation';

describe('attachment file validation', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'memora-attachments-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('requires the extension and MIME type to match', () => {
    expect(() =>
      getAttachmentFilePolicy('photo.jpg', 'application/pdf'),
    ).toThrow(BadRequestException);
  });

  it('rejects a supported extension when the file signature does not match', async () => {
    const filePath = join(directory, 'fake-image.jpg');
    await writeFile(filePath, '%PDF-1.7');

    await expect(
      assertFileSignature(filePath, 'fake-image.jpg'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a JPEG with a matching file signature', async () => {
    const filePath = join(directory, 'photo.jpg');
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0x00]));

    expect(getAttachmentFilePolicy('photo.jpg', 'image/jpeg').type).toBe(
      'IMAGE',
    );
    await expect(
      assertFileSignature(filePath, 'photo.jpg'),
    ).resolves.toBeUndefined();
  });
});
