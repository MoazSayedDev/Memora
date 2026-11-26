function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function capsuleMemberJoinedTemplate(
  capsuleTitle: string,
  memberName: string,
): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:40px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:28px;">A member joined ${escapeHtml(capsuleTitle)}</h1>
            <p style="margin:0;color:#526078;line-height:1.6;">${escapeHtml(memberName)} joined your capsule using an invitation link.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
