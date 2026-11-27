import { BadRequestException } from '@nestjs/common';
import { AttachmentType } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';

export const MAX_FILES_PER_UPLOAD = 10;

const FILE_POLICIES = {
  '.jpg': { type: AttachmentType.IMAGE, mimeTypes: ['image/jpeg'] },
  '.jpeg': { type: AttachmentType.IMAGE, mimeTypes: ['image/jpeg'] },
  '.png': { type: AttachmentType.IMAGE, mimeTypes: ['image/png'] },
  '.webp': { type: AttachmentType.IMAGE, mimeTypes: ['image/webp'] },
  '.mp4': { type: AttachmentType.VIDEO, mimeTypes: ['video/mp4'] },
  '.webm': { type: AttachmentType.VIDEO, mimeTypes: ['video/webm'] },
  '.mov': { type: AttachmentType.VIDEO, mimeTypes: ['video/quicktime'] },
  '.pdf': { type: AttachmentType.DOCUMENT, mimeTypes: ['application/pdf'] },
  '.doc': { type: AttachmentType.DOCUMENT, mimeTypes: ['application/msword'] },
  '.docx': {
    type: AttachmentType.DOCUMENT,
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  '.txt': { type: AttachmentType.DOCUMENT, mimeTypes: ['text/plain'] },
  '.mp3': { type: AttachmentType.AUDIO, mimeTypes: ['audio/mpeg'] },
  '.wav': { type: AttachmentType.AUDIO, mimeTypes: ['audio/wav'] },
  '.m4a': {
    type: AttachmentType.AUDIO,
    mimeTypes: ['audio/mp4', 'audio/x-m4a'],
  },
} as const;

export type AttachmentFilePolicy =
  (typeof FILE_POLICIES)[keyof typeof FILE_POLICIES];

export function getAttachmentFilePolicy(
  originalName: string,
  mimeType: string,
): AttachmentFilePolicy {
  const extension = extname(originalName).toLowerCase();
  const policy = FILE_POLICIES[extension as keyof typeof FILE_POLICIES];
  if (!policy || !policy.mimeTypes.some((accepted) => accepted === mimeType)) {
    throw new BadRequestException(
      'Unsupported attachment extension or MIME type',
    );
  }
  return policy;
}

export async function assertFileSignature(
  filePath: string,
  originalName: string,
) {
  const extension = extname(originalName).toLowerCase();
  const file = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const matches = (() => {
      switch (extension) {
        case '.jpg':
        case '.jpeg':
          return (
            bytes.length >= 3 &&
            bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
          );
        case '.png':
          return (
            bytes.length >= 8 &&
            bytes
              .subarray(0, 8)
              .equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
              )
          );
        case '.webp':
          return (
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          );
        case '.mp4':
        case '.mov':
        case '.m4a':
          return bytes.toString('ascii', 4, 8) === 'ftyp';
        case '.webm':
          return (
            bytes.length >= 4 &&
            bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
          );
        case '.pdf':
          return bytes.toString('ascii', 0, 5) === '%PDF-';
        case '.doc':
          return (
            bytes.length >= 8 &&
            bytes
              .subarray(0, 8)
              .equals(
                Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
              )
          );
        case '.docx':
          return (
            bytes.length >= 4 &&
            bytes.toString('ascii', 0, 4) === 'PK\u0003\u0004'
          );
        case '.mp3':
          return (
            bytes.toString('ascii', 0, 3) === 'ID3' ||
            (bytes.length >= 2 &&
              bytes[0] === 0xff &&
              (bytes[1] & 0xe0) === 0xe0)
          );
        case '.wav':
          return (
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WAVE'
          );
        case '.txt':
          return bytes.length > 0 && !bytes.includes(0);
        default:
          return false;
      }
    })();

    if (!matches || (extension === '.txt' && !(await isPlainText(filePath)))) {
      throw new BadRequestException(
        'Attachment content does not match its file type',
      );
    }
  } finally {
    await file.close();
  }
}

async function isPlainText(filePath: string) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    let hasContent = false;
    for await (const chunk of createReadStream(filePath)) {
      hasContent = true;
      const text = decoder.decode(chunk, { stream: true });
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) {
        return false;
      }
    }
    const remaining = decoder.decode();
    return (
      hasContent &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(remaining)
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}
