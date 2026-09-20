/**
 * Quitte la console pour une adresse externe (la boîte de dialogue Facebook). Isolé pour que
 * les tests l'espionnent : jsdom n'implémente pas la navigation.
 */
export function redirectTo(url: string): void {
  window.location.assign(url);
}
