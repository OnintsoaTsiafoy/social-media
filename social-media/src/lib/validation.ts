/** Client-side validation. The backend re-validates everything. */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PasswordChecks = {
  length: boolean;
  upperAndLower: boolean;
  digit: boolean;
  special: boolean;
};

/** Password policy from the spec; the special character is recommended, not required. */
export function checkPassword(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    upperAndLower: /[a-zà-ÿ]/.test(password) && /[A-ZÀ-Ÿ]/.test(password),
    digit: /\d/.test(password),
    special: /[^A-Za-zÀ-ÿ0-9]/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const checks = checkPassword(password);
  return checks.length && checks.upperAndLower && checks.digit;
}

/** 0 → 4, for the strength meter. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  const checks = checkPassword(password);
  return Object.values(checks).filter(Boolean).length;
}

export function isEmailValid(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** Trim, then lowercase - the spec asks for both before submitting. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const messages = {
  required: 'Ce champ est obligatoire.',
  emailInvalid: 'Saisissez une adresse email valide.',
  nameLength: 'Entre 2 et 80 caractères.',
  displayNameLength: 'Entre 2 et 100 caractères.',
  passwordPolicy: '8 caractères min., 1 majuscule, 1 minuscule, 1 chiffre',
  passwordMismatch: 'Les mots de passe ne correspondent pas.',
  termsRequired: 'Veuillez accepter les conditions d’utilisation.',
  privacyRequired: 'Veuillez accepter la politique de confidentialité.',
  textRequired: 'Le texte de la publication est obligatoire.',
  networkRequired: 'Sélectionnez au moins un réseau.',
  responseRequired: 'La réponse ne peut pas être vide.',
  dateInFuture: 'Choisissez une date et une heure futures.',
} as const;

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return messages.required;
  if (trimmed.length < 2 || trimmed.length > 80) return messages.nameLength;
  return undefined;
}

export function validateDisplayName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined; // optional
  if (trimmed.length < 2 || trimmed.length > 100) return messages.displayNameLength;
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return messages.required;
  if (!isEmailValid(value)) return messages.emailInvalid;
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return messages.required;
  if (!isPasswordValid(value)) return messages.passwordPolicy;
  return undefined;
}

export function validateConfirmation(password: string, confirmation: string): string | undefined {
  if (!confirmation) return messages.required;
  if (password !== confirmation) return messages.passwordMismatch;
  return undefined;
}

/** Per-network character budgets, used by the composer's counter. */
export const networkLimits = {
  facebook: 63_206,
  instagram: 2_200,
} as const;

/** The tightest limit across the selected networks. */
export function characterLimitFor(networks: ('facebook' | 'instagram')[]): number {
  if (networks.length === 0) return networkLimits.instagram;
  return Math.min(...networks.map((network) => networkLimits[network]));
}

export const MAX_HASHTAGS = 15;

/** `Été 2026!` → `#ete2026` */
export function normaliseHashtag(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^#+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase();
  return cleaned ? `#${cleaned}` : '';
}

/** Normalises, drops empties and de-duplicates while preserving order. */
export function mergeHashtags(existing: string[], incoming: string[]): string[] {
  const result: string[] = [];
  for (const tag of [...existing, ...incoming]) {
    const normalised = normaliseHashtag(tag);
    if (normalised && !result.includes(normalised)) result.push(normalised);
  }
  return result.slice(0, MAX_HASHTAGS);
}

export const MEDIA_CONSTRAINTS = {
  maxBytes: 8_000_000,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  minDimension: 320,
} as const;

export function validateMedia(asset: {
  mimeType: string;
  size: number;
  width: number;
  height: number;
}): string | undefined {
  if (!MEDIA_CONSTRAINTS.allowedMimeTypes.includes(asset.mimeType as never)) {
    return 'Format non supporté. Utilisez un fichier JPEG, PNG ou WebP.';
  }
  if (asset.size > MEDIA_CONSTRAINTS.maxBytes) {
    return 'Fichier trop lourd. La taille maximale est de 8 Mo.';
  }
  if (asset.width < MEDIA_CONSTRAINTS.minDimension || asset.height < MEDIA_CONSTRAINTS.minDimension) {
    return `Dimensions trop petites. Minimum ${MEDIA_CONSTRAINTS.minDimension} × ${MEDIA_CONSTRAINTS.minDimension} px.`;
  }
  return undefined;
}
