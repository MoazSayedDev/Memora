export function passwordResetTemplate(
  resetUrl: string,
  expiresInMinutes = 15,
): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:40px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:28px;">Reset your password</h1>
            <p style="margin:0 0 24px;color:#526078;line-height:1.6;">We received a request to reset your Memora password.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#5b4cf0;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:8px;">Reset password</a>
            <p style="margin:24px 0 8px;color:#526078;line-height:1.6;">This link expires in ${expiresInMinutes} minutes. If you did not request a reset, you can ignore this email.</p>
            <p style="margin:0;color:#526078;line-height:1.6;">If the button does not work, copy and paste this URL:</p>
            <p style="word-break:break-all;"><a href="${resetUrl}" style="color:#5b4cf0;">${resetUrl}</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
