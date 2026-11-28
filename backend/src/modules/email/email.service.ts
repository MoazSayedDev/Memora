import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { emailVerificationTemplate } from './templates/email-verification.template';
import { passwordResetTemplate } from './templates/password-reset.template';
import { capsuleInvitationTemplate } from './templates/capsule-invitation.template';
import { capsuleMemberJoinedTemplate } from './templates/capsule-member-joined.template';
import { capsuleOpenedTemplate } from './templates/capsule-opened.template';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly configService: ConfigService) {
    const port = Number(this.configService.getOrThrow<string>('MAIL_PORT'));
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAIL_HOST'),
      port,
      secure: port === 465,
      auth: {
        user: this.configService.getOrThrow<string>('MAIL_USER'),
        pass: this.configService.getOrThrow<string>('MAIL_PASSWORD'),
      },
    });
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error('SMTP connection verification failed', error);
      throw new InternalServerErrorException('Email service unavailable');
    }
  }

  async sendEmailVerification(
    to: string,
    verificationToken: string,
  ): Promise<void> {
    const frontendUrl = this.configService
      .getOrThrow<string>('FRONTEND_URL')
      .replace(/\/$/, '');
    const verificationUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    await this.sendHtml(
      to,
      'Verify your Memora email',
      emailVerificationTemplate(verificationUrl),
    );
  }

  async sendPasswordReset(to: string, resetToken: string): Promise<void> {
    const frontendUrl = this.configService
      .getOrThrow<string>('FRONTEND_URL')
      .replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
    await this.sendHtml(
      to,
      'Reset your Memora password',
      passwordResetTemplate(resetUrl),
    );
  }

  async sendCapsuleInvitation(
    to: string,
    capsuleTitle: string,
    invitationUrl: string,
  ): Promise<void> {
    await this.sendHtml(
      to,
      `Invitation to ${capsuleTitle} on Memora`,
      capsuleInvitationTemplate(capsuleTitle, invitationUrl),
    );
  }

  async sendCapsuleMemberJoined(
    to: string,
    capsuleTitle: string,
    memberName: string,
  ): Promise<void> {
    await this.sendHtml(
      to,
      `A member joined ${capsuleTitle} on Memora`,
      capsuleMemberJoinedTemplate(capsuleTitle, memberName),
    );
  }

  async sendCapsuleOpened(to: string, capsuleTitle: string): Promise<void> {
    await this.sendHtml(
      to,
      `${capsuleTitle} is now open on Memora`,
      capsuleOpenedTemplate(capsuleTitle),
    );
  }

  private async sendHtml(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.configService.getOrThrow<string>('MAIL_FROM'),
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw new InternalServerErrorException('Email delivery failed');
    }
  }
}
