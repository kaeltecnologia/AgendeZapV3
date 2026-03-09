/**
 * Security utilities — AgendeZap
 */

/** Mask a phone number for logging: 5511999887766 → 55***7766 */
export function maskPhone(phone: string): string {
  if (!phone) return '***';
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return '***';
  return clean.slice(0, 2) + '***' + clean.slice(-4);
}

/** Sanitize user input — strips HTML tags to prevent XSS in rendered content */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Sanitize text for safe display (strips actual tags, keeps plain text) */
export function stripHtml(input: string): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '');
}
