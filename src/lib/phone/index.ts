/**
 * Central Saudi mobile number handling.
 *
 * Every phone number in the system passes through `normalizeSaudiPhone` before it
 * is stored or compared. Raw user input is NEVER used as an identity key, so
 * "0551234567" and "+966551234567" always resolve to the same customer.
 */

/** Digits assigned to Saudi mobile operators (5 followed by one of these). */
const MOBILE_SECOND_DIGITS = ['0', '1', '3', '4', '5', '6', '7', '8', '9'] as const;

const E164_PATTERN = /^\+9665[0-9]{8}$/;

/** Maps Arabic-Indic and Eastern Arabic-Indic digits onto ASCII. */
function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Reduces any accepted Saudi input format to E.164 (+9665XXXXXXXX).
 * Returns null when the input is not a valid Saudi mobile number.
 *
 * Accepted: +9665XXXXXXXX, 009665XXXXXXXX, 9665XXXXXXXX, 05XXXXXXXX, 5XXXXXXXX
 * (with any spacing, dashes or parentheses, and Arabic-Indic digits).
 */
export function normalizeSaudiPhone(input: string | null | undefined): string | null {
  if (!input) return null;

  let value = toAsciiDigits(String(input)).replace(/[\s()\-.‏‎]/g, '');
  if (!value) return null;

  if (value.startsWith('00')) value = `+${value.slice(2)}`;

  let national: string;
  if (value.startsWith('+966')) national = value.slice(4);
  else if (value.startsWith('966')) national = value.slice(3);
  else if (value.startsWith('0')) national = value.slice(1);
  else national = value;

  if (!/^[0-9]+$/.test(national)) return null;
  if (national.length !== 9) return null;
  if (national[0] !== '5') return null;
  if (!MOBILE_SECOND_DIGITS.includes(national[1] as (typeof MOBILE_SECOND_DIGITS)[number])) {
    return null;
  }

  return `+966${national}`;
}

/** True when the input is a valid Saudi mobile number in any accepted format. */
export function isValidSaudiPhone(input: string | null | undefined): boolean {
  return normalizeSaudiPhone(input) !== null;
}

/** True when the value is already a stored-format Saudi mobile number. */
export function isNormalizedSaudiPhone(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** "+966551234567" -> "+966 55 123 4567" for display. */
export function formatSaudiPhone(input: string | null | undefined): string {
  const normalized = normalizeSaudiPhone(input);
  if (!normalized) return input ?? '';
  const n = normalized.slice(4);
  return `+966 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
}

/** "+966551234567" -> "+966 55 ••• 4567" for confirmation screens. */
export function maskSaudiPhone(input: string | null | undefined): string {
  const normalized = normalizeSaudiPhone(input);
  if (!normalized) return input ?? '';
  const n = normalized.slice(4);
  return `+966 ${n.slice(0, 2)} ••• ${n.slice(5)}`;
}

/** Formats the 9 national digits as the user types: "55 123 4567". */
export function formatNationalInput(raw: string): string {
  const digits = toAsciiDigits(raw)
    .replace(/\D/g, '')
    .replace(/^966/, '')
    .replace(/^0/, '')
    .slice(0, 9);
  const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 9)].filter(Boolean);
  return parts.join(' ');
}
