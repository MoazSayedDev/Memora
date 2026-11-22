import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));

const mockSendMail = jest.fn();
const mockVerify = jest.fn();

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(() => ({
      sendMail: mockSendMail,
      verify: mockVerify,
    })),
  },
}));

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(() => {
    mockSendMail.mockReset();
    mockVerify.mockReset();
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          MAIL_HOST: 'smtp.gmail.com',
          MAIL_PORT: '587',
          MAIL_USER: 'test@memora.test',
          MAIL_PASSWORD: 'test-password',
          MAIL_FROM: 'Memora <test@memora.test>',
          FRONTEND_URL: 'http://localhost:5173',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    service = new EmailService(configService);
  });

  it('verifies the SMTP connection', async () => {
    mockVerify.mockResolvedValue(true);
    await expect(service.verifyConnection()).resolves.toBe(true);
  });

  it('sends verification and password reset emails', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-message' });
    await expect(
      service.sendEmailVerification(
        'user@memora.test',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.sendPasswordReset(
        'user@memora.test',
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ),
    ).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('handles SMTP delivery failures', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(
      service.sendEmailVerification('user@memora.test', 'token'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
