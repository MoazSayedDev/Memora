function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function capsuleInvitationTemplate(
  capsuleTitle: string,
  invitationUrl: string,
): string {
  const safeTitle = escapeHtml(capsuleTitle);
  const safeUrl = escapeHtml(invitationUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:40px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:28px;">You are invited to ${safeTitle}</h1>
            <p style="margin:0 0 24px;color:#526078;line-height:1.6;">Join this capsule on Memora and share memories with its members.</p>
            <a href="${safeUrl}" style="display:inline-block;background:#5b4cf0;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:8px;">View invitation</a>
            <p style="margin:24px 0 8px;color:#526078;line-height:1.6;">If the button does not work, copy and paste this URL:</p>
            <p style="word-break:break-all;"><a href="${safeUrl}" style="color:#5b4cf0;">${safeUrl}</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
