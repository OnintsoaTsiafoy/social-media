import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "@/App";

/**
 * Parcours de bout en bout contre la VRAIE API (celle de Compose, avec `./scripts/seed.ps1`) :
 * il vérifie que les types de la console correspondent bien aux réponses réelles, ce que les
 * jeux de données des autres tests ne peuvent pas garantir.
 *
 *   ADMIN_E2E=1 VITE_API_BASE_URL=http://localhost:3000/api/v1 npm test -- e2e
 *
 * Ignoré par défaut. Les seules écritures sont réversibles (un mot-clé ajouté puis retiré, un
 * interrupteur basculé deux fois) et le compte utilisé est celui du seed.
 */
const enabled = process.env.ADMIN_E2E === "1";
const EMAIL = process.env.ADMIN_E2E_EMAIL ?? "admin@hootly.app";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "ChangeMe123!";

function go(screenId: string) {
  window.location.hash = `#/${screenId}`;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const headings = {
  overview: "Vue d'ensemble de la plateforme",
  supervision: "Supervision IA",
  analytics: "Analytique",
  users: "Utilisateurs et rôles",
  configuration: "Configuration",
};

describe.skipIf(!enabled)("console contre l'API réelle", () => {
  it("se connecte, parcourt les six écrans sans erreur et modifie la configuration de façon réversible", async () => {
    render(<App />);

    // --- Connexion -----------------------------------------------------------------------------
    fireEvent.change(await screen.findByLabelText("Adresse e-mail"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const shown = (name: string) => screen.findByRole("heading", { level: 1, name }, { timeout: 10_000 });
    expect(await shown(headings.overview)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // La vue d'ensemble affiche de vrais chiffres, pas des jeux de données.
    expect(screen.getAllByText("Non disponible").length + screen.getAllByText(/\d/).length).toBeGreaterThan(0);
    const nav = within(screen.getByRole("navigation", { name: "Navigation principale" }));
    await waitFor(() => expect(nav.getByRole("link", { name: /Pages/ }).textContent).toMatch(/\d/));

    // --- Chaque écran charge sans encart d'erreur ------------------------------------------------
    go("supervision");
    expect(await shown(headings.supervision)).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".pipeline__steps")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.queryByRole("alert")).toBeNull();

    go("analytics");
    expect(await shown(headings.analytics)).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".chart__value")).toBeTruthy(), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByRole("table", { name: "Performance par page" })).toBeTruthy(), { timeout: 10_000 });
    expect(screen.queryByRole("alert")).toBeNull();

    go("users");
    expect(await shown(headings.users)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Ouvrir Amine Rahali/ }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    go("pages");
    expect(await screen.findByRole("heading", { level: 1, name: "Pages connectées" }, { timeout: 10_000 })).toBeTruthy();
    const cards = await screen.findAllByRole("article", {}, { timeout: 10_000 });
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();

    // Un interrupteur basculé deux fois : l'état initial est restauré.
    const firstSwitch = within(cards[0] as HTMLElement).getByRole("switch");
    const initial = firstSwitch.getAttribute("aria-checked");
    fireEvent.click(firstSwitch);
    await waitFor(() => expect(within(cards[0] as HTMLElement).getByRole("switch").getAttribute("aria-checked")).not.toBe(initial));
    fireEvent.click(within(cards[0] as HTMLElement).getByRole("switch"));
    await waitFor(() => expect(within(cards[0] as HTMLElement).getByRole("switch").getAttribute("aria-checked")).toBe(initial));

    // --- Configuration : mot-clé ajouté puis retiré, visible dans le journal d'audit ---------------
    go("configuration");
    expect(await shown(headings.configuration)).toBeTruthy();
    const word = `e2e${Date.now().toString(36)}`;
    fireEvent.change(await screen.findByLabelText("Nouveau mot-clé de modération", {}, { timeout: 10_000 }), { target: { value: word } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText(word, {}, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(`Mot-clé « ${word} » ajouté au filtre de modération`)).toBeTruthy(), {
      timeout: 10_000,
    });

    fireEvent.click(screen.getByRole("button", { name: `Retirer le mot-clé ${word}` }));
    await waitFor(() => expect(screen.queryByText(word)).toBeNull(), { timeout: 10_000 });
  }, 60_000);
});
