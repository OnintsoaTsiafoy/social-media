/** Select options shared across screens. */

import type { SelectOption } from '@/components/ui';
import type { BrandTone } from '@/types';

export const LANGUAGE_OPTIONS: SelectOption<string>[] = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

export const TIMEZONE_OPTIONS: SelectOption<string>[] = [
  { value: 'Europe/Paris', label: 'UTC+1 · Paris' },
  { value: 'Europe/London', label: 'UTC+0 · Londres' },
  { value: 'Africa/Casablanca', label: 'UTC+1 · Casablanca' },
  { value: 'Indian/Antananarivo', label: 'UTC+3 · Antananarivo' },
  { value: 'America/New_York', label: 'UTC−5 · New York' },
];

export const TONE_OPTIONS: SelectOption<BrandTone>[] = [
  { value: 'professional', label: 'Professionnel', description: 'Neutre et factuel.' },
  { value: 'friendly', label: 'Amical', description: 'Chaleureux et direct.' },
  { value: 'empathetic', label: 'Empathique', description: 'Reconnaît la frustration avant de répondre.' },
  { value: 'formal', label: 'Formel', description: 'Vouvoiement systématique, aucun emoji.' },
  { value: 'custom', label: 'Personnalisé', description: 'Défini dans les paramètres de marque.' },
];

export const SECTOR_OPTIONS: SelectOption<string>[] = [
  { value: 'Lifestyle', label: 'Lifestyle' },
  { value: 'Restauration', label: 'Restauration' },
  { value: 'Mode', label: 'Mode' },
  { value: 'Technologie', label: 'Technologie' },
  { value: 'Services', label: 'Services' },
  { value: 'Autre', label: 'Autre' },
];

export const TARGET_LENGTH_OPTIONS: SelectOption<string>[] = [
  { value: '1 phrase', label: '1 phrase' },
  { value: '2 phrases', label: '2 phrases' },
  { value: '3 phrases', label: '3 phrases' },
  { value: 'Libre', label: 'Libre' },
];

export const REMINDER_OPTIONS: SelectOption<string>[] = [
  { value: 'none', label: 'Aucun rappel' },
  { value: '15', label: '15 min avant' },
  { value: '30', label: '30 min avant' },
  { value: '60', label: '1 h avant' },
];

export const PRIORITY_OPTIONS: SelectOption<'low' | 'medium' | 'high'>[] = [
  { value: 'low', label: 'Faible' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'high', label: 'Élevée' },
];

export const QUIET_HOURS_OPTIONS: SelectOption<string>[] = [
  { value: 'off', label: 'Désactivée' },
  { value: '21:00-07:00', label: '21:00 – 07:00' },
  { value: '22:00-07:00', label: '22:00 – 07:00' },
  { value: '23:00-08:00', label: '23:00 – 08:00' },
];

/** Half-hour slots for the schedule screen's time picker. */
export const TIME_SLOT_OPTIONS: SelectOption<string>[] = Array.from({ length: 48 }, (_, index) => {
  const hours = String(Math.floor(index / 2)).padStart(2, '0');
  const minutes = index % 2 === 0 ? '00' : '30';
  const value = `${hours}:${minutes}`;
  return { value, label: value };
});
