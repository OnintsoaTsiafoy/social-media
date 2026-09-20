import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { login } from "@/api/session";
import { frenchSpacing } from "@/i18n";
import type { UserList } from "@/api/types";
import { redirectTo } from "@/lib/navigation";
import * as fixtures from "@/test/fixtures";
import { mockApi } from "@/test/mockApi";

// jsdom n'implémente pas la navigation : la sortie vers Facebook est espionnée.
vi.mock("@/lib/navigation", () => ({ redirectTo: vi.fn() }));

type Api = ReturnType<typeof mockApi>;

/** Ouvre une session comme le ferait une connexion précédente : l'app la reprend au chargement. */
async function openApp(api: Api, hash = "") {
  await login("admin@hootly.app", "secret");
  window.location.hash = hash;
  const view = render(<App />);
  return { ...view, api };
}

function navigate(id: string) {
  act(() => {
    window.location.hash = `#/${id}`;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

/** Nom accessible tel que l'app le fabrique en français (espace insécable avant « : », « % »…). */
const nb = frenchSpacing;
/** Texte d'un noeud avec les espaces insécables ramenées à des espaces ordinaires. */
const plain = (text: string | null | undefined) => (text ?? "").replaceAll(" ", " ");
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
const lastCall = (api: Api, method: string, path: string) => api.callsTo(method, path).at(-1);

// ---------------------------------------------------------------------------------------------------
describe("connexion", () => {
  it("affiche l'écran de connexion, en français, tant qu'aucune session n'est ouverte", async () => {
    const api = mockApi();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Connexion à la console" })).toBeTruthy();
    expect(screen.getByLabelText("Adresse e-mail")).toBeTruthy();
    expect(screen.getByLabelText("Mot de passe")).toBeTruthy();
    expect(api.callsTo("GET", "/admin/summary")).toHaveLength(0);
  });

  it("ouvre la console avec des identifiants valides", async () => {
    const api = mockApi();
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Adresse e-mail"), { target: { value: " admin@hootly.app " } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "ChangeMe123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await heading("Vue d'ensemble de la plateforme")).toBeTruthy();
    expect(lastCall(api, "POST", "/auth/login")?.body).toEqual({ email: "admin@hootly.app", password: "ChangeMe123!" });
    // Le rôle est confirmé côté serveur avant d'entrer.
    expect(api.callsTo("GET", "/admin/session")).toHaveLength(1);
    expect(screen.getByText("Amine Rahali")).toBeTruthy();
  });

  it("traduit l'erreur de mauvais identifiants au lieu d'afficher le texte du serveur", async () => {
    mockApi({ "POST /auth/login": () => ({ status: 401, error: { code: "invalid_credentials", message: "Adresse email ou mot de passe incorrect." } }) });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Adresse e-mail"), { target: { value: "x@y.fr" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "mauvais" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Adresse e-mail ou mot de passe incorrect.");
    expect(screen.getByRole("heading", { level: 1, name: "Connexion à la console" })).toBeTruthy();
  });

  it("refuse un compte valide mais non administrateur, et ne garde pas sa session", async () => {
    const api = mockApi({ "GET /admin/session": () => ({ status: 403, error: { code: "forbidden" } }) });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Adresse e-mail"), { target: { value: "lea@studio-vega.fr" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "ChangeMe123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Ce compte n'a pas accès à la console d'administration.");
    await waitFor(() => expect(api.callsTo("POST", "/auth/logout")).toHaveLength(1));
    expect(window.sessionStorage.getItem("pulse.refreshToken")).toBeNull();
  });

  it("reprend la session de l'onglet sans redemander le mot de passe", async () => {
    const api = mockApi();
    await openApp(api);
    expect(await heading("Vue d'ensemble de la plateforme")).toBeTruthy();
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("revient à la connexion quand la session est perdue en cours de route", async () => {
    let refreshes = 0;
    const api = mockApi({
      "POST /auth/refresh": () =>
        ++refreshes === 1
          ? { data: { accessToken: "a2", refreshToken: "r2", tokenType: "Bearer", expiresIn: 900, user: fixtures.PROFILE } }
          : { status: 401, error: { code: "authentication_required" } },
      "GET /admin/overview": () => ({ status: 401, error: { code: "token_expired" } }),
    });
    await openApp(api);
    expect(await screen.findByRole("heading", { level: 1, name: "Connexion à la console" })).toBeTruthy();
  });

  it("se déconnecte depuis la barre latérale", async () => {
    const api = mockApi();
    await openApp(api);
    await heading("Vue d'ensemble de la plateforme");
    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Connexion à la console" })).toBeTruthy();
    expect(api.callsTo("POST", "/auth/logout")).toHaveLength(1);
    expect(window.sessionStorage.getItem("pulse.refreshToken")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
describe("langue", () => {
  it("est en français par défaut", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");
    const nav = within(screen.getByRole("navigation", { name: "Navigation principale" }));
    expect(nav.getByRole("link", { name: /Vue d'ensemble/ }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: /Supervision IA/ })).toBeTruthy();
    expect(nav.getByRole("link", { name: /Utilisateurs et rôles/ })).toBeTruthy();
    expect(document.documentElement.lang).toBe("fr");
    expect(document.title).toBe("Vue d'ensemble de la plateforme · Hootly");
  });

  it("passe en anglais, le mémorise et met à jour la langue du document", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(await heading("Platform overview")).toBeTruthy();
    expect(screen.getByRole("link", { name: /AI supervision/ })).toBeTruthy();
    expect(window.localStorage.getItem("pulse.locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Platform overview · Hootly");
    // Les valeurs suivent aussi la langue : 4 min 12 s devient 4m 12s.
    expect(screen.getByText("4m 12s")).toBeTruthy();
    expect(within(screen.getByText("AI resolved").closest(".kpi") as HTMLElement).getByText("68.4%")).toBeTruthy();
  });

  it("reprend le choix mémorisé au rechargement", async () => {
    window.localStorage.setItem("pulse.locale", "en");
    await openApp(mockApi());
    expect(await heading("Platform overview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("traduit aussi les messages d'erreur", async () => {
    window.localStorage.setItem("pulse.locale", "en");
    mockApi({ "POST /auth/login": () => ({ status: 401, error: { code: "invalid_credentials" } }) });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email address"), { target: { value: "x@y.fr" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Incorrect email address or password.");
  });
});

// ---------------------------------------------------------------------------------------------------
describe("coque", () => {
  it("affiche les compteurs réels : file à relire, comptes, pages, SLA, autonomie", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");

    const nav = within(screen.getByRole("navigation", { name: "Navigation principale" }));
    expect(nav.getByRole("link", { name: /Supervision IA/ }).textContent).toContain("2");
    expect(nav.getByRole("link", { name: /Utilisateurs et rôles/ }).textContent).toContain("5");
    expect(nav.getByRole("link", { name: /Pages/ }).textContent).toContain("3");

    const stats = plain(document.querySelector(".topbar__stats")?.textContent);
    expect(stats).toContain("Comptes en ligne 2/5");
    expect(stats).toContain("SLA 94,2 %");
    expect(stats).toContain("Autonomie IA 68,4 %");
    expect(screen.getByText(/2 en ligne sur 5 comptes · dernier événement/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "2 alertes à traiter" })).toBeTruthy();
  });

  it("affiche un tiret plutôt qu'un 0 quand une mesure est indisponible", async () => {
    await openApp(
      mockApi({ "GET /admin/summary": () => ({ data: { ...fixtures.SUMMARY, sla: { targetMinutes: 15, complianceRate: null }, ai: { autonomyRate: null } } }) }),
    );
    await heading("Vue d'ensemble de la plateforme");
    const stats = plain(document.querySelector(".topbar__stats")?.textContent);
    expect(stats).toContain("SLA —");
    expect(stats).toContain("Autonomie IA —");
  });

  it("n'expose que les routes existantes et pas d'action factice", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");
    const hrefs = within(screen.getByRole("navigation", { name: "Navigation principale" }))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["#/overview", "#/supervision", "#/analytics", "#/users", "#/pages", "#/configuration"]);
    expect(screen.queryByRole("button", { name: /Inviter/ })).toBeNull();
  });

  it("la recherche de l'en-tête ouvre les utilisateurs filtrés", async () => {
    const api = mockApi();
    await openApp(api);
    await heading("Vue d'ensemble de la plateforme");

    const search = screen.getByRole("searchbox", { name: "Rechercher un utilisateur par nom ou e-mail" });
    fireEvent.change(search, { target: { value: "léa" } });
    fireEvent.submit(search.closest("form") as HTMLFormElement);
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(await heading("Utilisateurs et rôles")).toBeTruthy();
    await waitFor(() => expect(lastCall(api, "GET", "/admin/users")?.query.q).toBe("léa"));
    expect((screen.getByLabelText("Filtrer les membres par nom ou e-mail") as HTMLInputElement).value).toBe("léa");
  });
});

// ---------------------------------------------------------------------------------------------------
describe("vue d'ensemble", () => {
  it("affiche les indicateurs renvoyés par l'API", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");

    const kpi = (label: string) => within(screen.getByText(label).closest(".kpi") as HTMLElement);
    expect(kpi("Commentaires analysés").getByText("1 284")).toBeTruthy();
    expect(kpi("Commentaires analysés").getByText("+28 %")).toBeTruthy();
    expect(kpi("Commentaires analysés").getByText("contre 1 000 sur la période précédente")).toBeTruthy();
    expect(kpi("1re réponse (médiane)").getByText("4 min 12 s")).toBeTruthy();
    expect(kpi("1re réponse (médiane)").getByText("−16 %")).toBeTruthy();
    expect(kpi("1re réponse (médiane)").getByText("Objectif SLA : 15 min")).toBeTruthy();
    expect(kpi("Résolus par l'IA").getByText("68,4 %")).toBeTruthy();
    expect(kpi("Résolus par l'IA").getByText("26 réponses IA envoyées sur 38")).toBeTruthy();
    expect(kpi("Escalades ouvertes").getByText("4")).toBeTruthy();
    // Plus d'escalades ouvertes que la période précédente : mauvaise nouvelle, donc en rouge.
    expect(kpi("Escalades ouvertes").getByText("+3").getAttribute("data-tone")).toBe("danger");
    expect(kpi("Escalades ouvertes").getByText("2 de plus de 2 h")).toBeTruthy();
  });

  it("écrit « Non disponible » et un tiret quand rien ne permet de calculer une mesure", async () => {
    const overview = structuredClone(fixtures.OVERVIEW);
    overview.kpis.firstResponse = { medianSeconds: null, previousMedianSeconds: null, deltaPercent: null, spark: [null, null], targetMinutes: 15 };
    overview.kpis.aiResolved = { rate: null, previousRate: null, deltaPoints: null, sentByAi: 0, totalReplies: 0, spark: [null] };
    overview.kpis.processed = { value: 0, previous: 0, deltaPercent: null, spark: [0, 0] };
    await openApp(mockApi({ "GET /admin/overview": () => ({ data: overview }) }));
    await heading("Vue d'ensemble de la plateforme");

    const kpi = (label: string) => within(screen.getByText(label).closest(".kpi") as HTMLElement);
    expect(kpi("1re réponse (médiane)").getByText("Non disponible")).toBeTruthy();
    expect(kpi("1re réponse (médiane)").getByText("—")).toBeTruthy();
    expect(kpi("Résolus par l'IA").getByText("Non disponible")).toBeTruthy();
    expect(kpi("Résolus par l'IA").getByText("Aucune réponse envoyée sur la période")).toBeTruthy();
    expect(kpi("Commentaires analysés").getByText("Aucune période précédente comparable")).toBeTruthy();
  });

  it("accorde « réponse(s) IA envoyée(s) » selon le nombre", async () => {
    const overview = structuredClone(fixtures.OVERVIEW);
    overview.kpis.aiResolved = { ...overview.kpis.aiResolved, sentByAi: 1, totalReplies: 3 };
    await openApp(mockApi({ "GET /admin/overview": () => ({ data: overview }) }));
    await heading("Vue d'ensemble de la plateforme");
    expect(screen.getByText("1 réponse IA envoyée sur 3")).toBeTruthy();
  });

  it("affiche le flux en direct, sa jauge et les étiquettes traduites", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");

    const hero = within(screen.getByLabelText("Activité en direct"));
    expect(hero.getByText("37")).toBeTruthy();
    expect(hero.getByText("COMMENTAIRES / H")).toBeTruthy();
    expect(hero.getByText("“Quand arrive le réassort de la crème n°3 ?”")).toBeTruthy();
    expect(hero.getByText("Question")).toBeTruthy();
    expect(hero.getByText("Positif")).toBeTruthy();
    expect(hero.getByText("À analyser")).toBeTruthy();
    expect(hero.getAllByRole("listitem")).toHaveLength(3);
  });

  it("dit qu'aucun commentaire n'est arrivé plutôt que d'afficher un flux vide", async () => {
    await openApp(mockApi({ "GET /admin/live": () => ({ data: { commentsLastHour: 0, generatedAt: new Date().toISOString(), feed: [] } }) }));
    await heading("Vue d'ensemble de la plateforme");
    expect(screen.getByText("Aucun commentaire reçu pour le moment.")).toBeTruthy();
  });

  it("filtre par réseau côté serveur et revient à tous les réseaux", async () => {
    const api = mockApi();
    await openApp(api);
    await heading("Vue d'ensemble de la plateforme");

    const pills = within(screen.getByRole("group", { name: "Filtrer par réseau" }));
    fireEvent.click(pills.getByRole("button", { name: /Facebook/ }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/overview")?.query.network).toBe("facebook"));
    expect(lastCall(api, "GET", "/admin/live")?.query.network).toBe("facebook");
    expect(pills.getByRole("button", { name: /Facebook/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("FLUX EN DIRECT · FACEBOOK")).toBeTruthy();

    // Appuyer deux fois sur le même réseau le désactive.
    fireEvent.click(pills.getByRole("button", { name: /Facebook/ }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/overview")?.query.network).toBe("all"));
    expect(pills.getByRole("button", { name: /Tous les réseaux/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("change de période en tournant sur 7, 30 et 90 jours", async () => {
    const api = mockApi();
    await openApp(api);
    await heading("Vue d'ensemble de la plateforme");

    const button = () => screen.getByRole("button", { name: /^Période\s: / });
    expect(plain(button().getAttribute("aria-label"))).toBe("Période : 7 derniers jours. Activer pour changer.");
    fireEvent.click(button());
    await waitFor(() => expect(lastCall(api, "GET", "/admin/overview")?.query.period).toBe("30d"));
    fireEvent.click(button());
    await waitFor(() => expect(lastCall(api, "GET", "/admin/overview")?.query.period).toBe("90d"));
    fireEvent.click(button());
    await waitFor(() => expect(lastCall(api, "GET", "/admin/overview")?.query.period).toBe("7d"));
  });

  it("affiche escalades, gravité, classement et santé du système", async () => {
    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");

    expect(screen.getByText("Rumeur de rappel produit sous le post de lancement")).toBeTruthy();
    expect(screen.getByText(/Nova Cosmetics · signalée par Nadia B\. · il y a 6 min/)).toBeTruthy();
    // Sans auteur connu, la ligne ne l'invente pas.
    expect(screen.getByText(/Nova Cosmetics IG · il y a 22 min/)).toBeTruthy();
    expect(screen.getByText("Critique")).toBeTruthy();
    expect(screen.getByText("Élevée")).toBeTruthy();
    expect(screen.getByText("Amel Haddad")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();

    const health = within(screen.getByText("Santé du système").closest(".card") as HTMLElement);
    expect(health.getByText("10 / 200")).toBeTruthy();
    expect(health.getByText("212 ms")).toBeTruthy();
    expect(health.getByText("120")).toBeTruthy();
    expect(health.getByText("2 pages")).toBeTruthy();
    expect(health.getByText("DÉGRADÉ")).toBeTruthy();
  });

  it("clôt une escalade : appel serveur, ligne retirée, confirmation", async () => {
    const api = mockApi({ "POST /admin/escalations/c1c1c1c1-0000-4000-8000-000000000001/resolve": () => ({ data: { id: "x", status: "processed" } }) });
    await openApp(api);
    await heading("Vue d'ensemble de la plateforme");

    fireEvent.click(screen.getAllByRole("button", { name: "Marquer traité" })[0] as HTMLElement);

    await waitFor(() => expect(screen.queryByText("Rumeur de rappel produit sous le post de lancement")).toBeNull());
    expect(api.callsTo("POST", "/admin/escalations/c1c1c1c1-0000-4000-8000-000000000001/resolve")).toHaveLength(1);
    expect((await screen.findAllByText("Escalade traitée · Nova Cosmetics")).length).toBeGreaterThan(0);
    // La seconde escalade reste, et le compteur de la coque est relu.
    expect(screen.getByText("Insultes répétées visant un modérateur")).toBeTruthy();
    await waitFor(() => expect(api.callsTo("GET", "/admin/summary").length).toBeGreaterThan(1));
  });

  it("exporte le rapport en CSV avec les chiffres affichés", async () => {
    const created: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return "blob:rapport";
      }),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await openApp(mockApi());
    await heading("Vue d'ensemble de la plateforme");
    fireEvent.click(screen.getByRole("button", { name: "Exporter le rapport" }));

    expect(click).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
    const text = await readBlob(created[0] as Blob);
    expect(text).toContain("Commentaires analysés;1 284");
    expect(text).toContain("Résolus par l'IA;68,4 %");
    expect((await screen.findAllByText(/^Rapport exporté \(rapport-plateforme-\d{4}-\d{2}-\d{2}\.csv\)$/)).length).toBeGreaterThan(0);
    click.mockRestore();
  });

  it("montre une erreur traduite avec « Réessayer », puis l'écran une fois le serveur revenu", async () => {
    let attempts = 0;
    const api = mockApi({
      "GET /admin/overview": () => (++attempts === 1 ? { status: 500, error: { code: "internal_error" } } : { data: fixtures.OVERVIEW }),
    });
    await openApp(api);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Impossible de charger ces données.")).toBeTruthy();
    expect(within(alert).getByText("Une erreur est survenue. Réessayez.")).toBeTruthy();
    expect(alert.textContent).not.toMatch(/internal_error|500/);

    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await heading("Vue d'ensemble de la plateforme")).toBeTruthy();
    expect(api.callsTo("GET", "/admin/overview")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------
describe("supervision IA", () => {
  const D1 = "d1d1d1d1-0000-4000-8000-000000000001";

  it("affiche la file réelle : brouillons, confiance, seuil, avertissements", async () => {
    await openApp(mockApi(), "#/supervision");
    await heading("Supervision IA");

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);

    const first = within(cards[0] as HTMLElement);
    expect(first.getByText("— Claire D.")).toBeTruthy();
    expect(first.getByText("71 %")).toBeTruthy();
    expect(first.getByText("SOUS LE SEUIL")).toBeTruthy(); // 71 < 82
    expect(first.getByText("Négatif")).toBeTruthy();
    expect(first.getByRole("button", { name: "Approuver et envoyer" }).hasAttribute("disabled")).toBe(false);

    // Second brouillon : pas de score, échec d'envoi, bloqué par le contrôle de sécurité.
    const second = within(cards[1] as HTMLElement);
    expect(second.getByText("— Auteur inconnu")).toBeTruthy();
    expect(second.getByText("non disponible")).toBeTruthy();
    expect(second.getByText("SANS SCORE")).toBeTruthy();
    expect(second.getByText("ÉCHEC D'ENVOI")).toBeTruthy();
    expect(second.getByText(/bloqué par le contrôle de sécurité/)).toBeTruthy();
    expect(second.getByText("Promesse de date non confirmée")).toBeTruthy();
    expect(second.getByRole("button", { name: "Réessayer l'envoi" }).hasAttribute("disabled")).toBe(true);
  });

  it("affiche le circuit de validation, l'état de l'analyse et la performance du modèle", async () => {
    await openApp(mockApi(), "#/supervision");
    await heading("Supervision IA");

    const pipeline = document.querySelector(".pipeline__steps")?.textContent ?? "";
    expect(pipeline).toContain("Détectés100");
    expect(pipeline).toContain("Brouillons IA80");
    expect(pipeline).toContain("À relire2");
    expect(pipeline).toContain("Publiées60");
    expect(screen.getByText("Analyse des nouveaux commentaires")).toBeTruthy();
    expect(screen.getByText("3 en attente")).toBeTruthy();

    const perf = within(screen.getByText("Performance du modèle").closest(".card") as HTMLElement);
    expect(perf.getByText("92,6 %")).toBeTruthy();
    expect(perf.getByText("5,1 %")).toBeTruthy();
    expect(perf.getByText("2,3 %")).toBeTruthy();
    expect(perf.getByText("1,2 s")).toBeTruthy();
    expect(perf.getByText("30 derniers jours · 100 décisions humaines")).toBeTruthy();
  });

  it("explique le seuil à partir des vrais brouillons et dit que l'envoi automatique n'est pas branché", async () => {
    await openApp(mockApi(), "#/supervision");
    await heading("Supervision IA");
    expect(screen.getByText("Équilibré : environ 75 % des brouillons passeraient sans relecture.")).toBeTruthy();
    expect(screen.getByText(/L'envoi automatique n'est pas encore branché/)).toBeTruthy();
    expect(screen.getByText("EN PAUSE")).toBeTruthy();
  });

  it("approuve et envoie : appel serveur, brouillon retiré, confirmation", async () => {
    const api = mockApi({ [`POST /admin/supervision/drafts/${D1}/approve`]: () => ({ data: { id: D1, commentId: "c", status: "sent" } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    fireEvent.click(within(screen.getAllByRole("article")[0] as HTMLElement).getByRole("button", { name: "Approuver et envoyer" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(lastCall(api, "POST", `/admin/supervision/drafts/${D1}/approve`)?.body).toEqual({});
    expect((await screen.findAllByText("Réponse publiée sur Nova Cosmetics")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.callsTo("GET", "/admin/summary").length).toBeGreaterThan(1));
  });

  it("envoie le texte modifié quand l'administrateur retouche le brouillon", async () => {
    const api = mockApi({ [`POST /admin/supervision/drafts/${D1}/approve`]: () => ({ data: { id: D1, commentId: "c", status: "sent" } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    const card = within(screen.getAllByRole("article")[0] as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Modifier le brouillon" }));
    const editor = card.getByLabelText("Texte de la réponse") as HTMLTextAreaElement;
    expect(editor.value).toBe("Bonjour Claire, nous sommes navrés pour ces trois commandes.");
    fireEvent.change(editor, { target: { value: "Bonjour Claire, votre dossier est prioritaire." } });
    fireEvent.click(card.getByRole("button", { name: "Approuver et envoyer" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(lastCall(api, "POST", `/admin/supervision/drafts/${D1}/approve`)?.body).toEqual({ text: "Bonjour Claire, votre dossier est prioritaire." });
  });

  it("ne laisse pas approuver un texte vide et permet d'annuler la modification", async () => {
    await openApp(mockApi(), "#/supervision");
    await heading("Supervision IA");
    const card = within(screen.getAllByRole("article")[0] as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Modifier le brouillon" }));
    fireEvent.change(card.getByLabelText("Texte de la réponse"), { target: { value: "   " } });
    expect(card.getByRole("button", { name: "Approuver et envoyer" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(card.getByRole("button", { name: "Annuler la modification" }));
    expect(card.queryByLabelText("Texte de la réponse")).toBeNull();
    expect(card.getByText("Bonjour Claire, nous sommes navrés pour ces trois commandes.")).toBeTruthy();
  });

  it("rejette avec un motif du catalogue (code stable envoyé au serveur)", async () => {
    const api = mockApi({ [`POST /admin/supervision/drafts/${D1}/reject`]: () => ({ data: { id: D1, commentId: "c", status: "rejected" } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    const card = within(screen.getAllByRole("article")[0] as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Rejeter" }));
    expect(card.getByText(/Qu'est-ce qui n'allait pas dans ce brouillon/)).toBeTruthy();
    // Le motif est demandé avant tout envoi : rien n'est parti.
    expect(api.callsTo("POST", `/admin/supervision/drafts/${D1}/reject`)).toHaveLength(0);
    fireEvent.click(card.getByRole("button", { name: "Ton inadapté" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(lastCall(api, "POST", `/admin/supervision/drafts/${D1}/reject`)?.body).toEqual({ reason: "wrong_tone" });
    expect((await screen.findAllByText("« Ton inadapté » enregistré · retour transmis à l'évaluation du modèle")).length).toBeGreaterThan(0);
  });

  it("escalade le commentaire à un manager", async () => {
    const api = mockApi({ [`POST /admin/supervision/drafts/${D1}/escalate`]: () => ({ data: { id: D1, commentId: "c", status: "escalated" } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    fireEvent.click(within(screen.getAllByRole("article")[0] as HTMLElement).getByRole("button", { name: "Escalader à un manager" }));

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(api.callsTo("POST", `/admin/supervision/drafts/${D1}/escalate`)).toHaveLength(1);
    expect((await screen.findAllByText("Commentaire escaladé à un manager")).length).toBeGreaterThan(0);
  });

  it("garde le brouillon et explique l'erreur quand l'envoi échoue", async () => {
    const api = mockApi({
      [`POST /admin/supervision/drafts/${D1}/approve`]: () => ({ status: 409, error: { code: "token_expired", message: "Le jeton Meta a expiré" } }),
    });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    fireEvent.click(within(screen.getAllByRole("article")[0] as HTMLElement).getByRole("button", { name: "Approuver et envoyer" }));

    expect((await screen.findAllByText("Le jeton de la page a expiré : reconnectez la page depuis l'application mobile.")).length).toBeGreaterThan(0);
    // La file est relue : l'état réel du serveur fait foi.
    await waitFor(() => expect(api.callsTo("GET", "/admin/supervision").length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("montre la file vide quand tout est relu", async () => {
    await openApp(
      mockApi({ "GET /admin/supervision": () => ({ data: { ...fixtures.SUPERVISION, queue: { total: 0, items: [] }, analysis: { waiting: 0 } } }) }),
      "#/supervision",
    );
    await heading("Supervision IA");
    expect(screen.getByText("File vide")).toBeTruthy();
    expect(screen.getByText("Aucun commentaire en attente d'analyse")).toBeTruthy();
  });

  it("annonce quand la file affichée est tronquée", async () => {
    await openApp(
      mockApi({ "GET /admin/supervision": () => ({ data: { ...fixtures.SUPERVISION, queue: { total: 120, items: fixtures.DRAFTS } } }) }),
      "#/supervision",
    );
    await heading("Supervision IA");
    expect(screen.getByText("2 brouillons affichés sur 120. Traitez-les pour voir les suivants.")).toBeTruthy();
  });

  it("enregistre le seuil d'autonomie modifié, une seule fois, même si l'on quitte l'écran aussitôt", async () => {
    const api = mockApi({ "PATCH /admin/settings/supervision": () => ({ data: { supervision: fixtures.SUPERVISION.settings } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    const slider = screen.getByRole("slider", { name: "Seuil d'autonomie" });
    fireEvent.change(slider, { target: { value: "88" } });
    fireEvent.change(slider, { target: { value: "90" } });
    // L'écran suit tout de suite ; la note se recalcule sur les vrais brouillons.
    expect(slider.getAttribute("aria-valuetext")).toBe("90 pour cent");
    expect(screen.getByText("Très strict : environ 100 % des brouillons nécessiteraient une relecture humaine.")).toBeTruthy();

    navigate("overview");
    await waitFor(() => expect(api.callsTo("PATCH", "/admin/settings/supervision")).toHaveLength(1));
    expect(lastCall(api, "PATCH", "/admin/settings/supervision")?.body).toEqual({ threshold: 90 });
  });

  it("bascule la réponse automatique et une règle d'escalade", async () => {
    const api = mockApi({ "PATCH /admin/settings/supervision": () => ({ data: { supervision: fixtures.SUPERVISION.settings } }) });
    await openApp(api, "#/supervision");
    await heading("Supervision IA");

    const toggle = screen.getByRole("switch", { name: "Réponse automatique" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("ACTIVÉE")).toBeTruthy();
    await waitFor(() => expect(lastCall(api, "PATCH", "/admin/settings/supervision")?.body).toEqual({ autoReply: true }));

    fireEvent.click(screen.getByRole("switch", { name: "Langue non prise en charge" }));
    navigate("overview");
    await waitFor(() => expect(lastCall(api, "PATCH", "/admin/settings/supervision")?.body).toEqual({ rules: { lang: true } }));
  });
});

// ---------------------------------------------------------------------------------------------------
describe("analytique", () => {
  it("affiche la courbe réelle : titre, valeur, tendance, période précédente", async () => {
    const api = mockApi();
    await openApp(api, "#/analytics");
    await heading("Analytique");

    expect(await screen.findByText("Taux d'engagement")).toBeTruthy();
    expect(screen.getByText("7,3 %")).toBeTruthy();
    expect(screen.getByText(/\+22\s?%/)).toBeTruthy();
    expect(document.querySelector(".chart__line")).toBeTruthy();
    expect(document.querySelector(".chart__prev")).toBeTruthy();
    expect(lastCall(api, "GET", "/admin/analytics/trend")?.query).toEqual({ metric: "engagement", period: "30d", sentiment: "all", network: "all" });
  });

  it("dit « Pas assez de données » quand aucune période n'a de valeur, sans tracer de zéro", async () => {
    const empty = { ...fixtures.TREND, points: fixtures.TREND.points.map((point) => ({ ...point, value: null })), summary: { value: null, previousValue: null, deltaPercent: null } };
    await openApp(mockApi({ "GET /admin/analytics/trend": () => ({ data: empty }) }), "#/analytics");
    await heading("Analytique");
    expect(await screen.findByText("Pas assez de données sur cette période.")).toBeTruthy();
    expect(document.querySelector(".chart__line")).toBeNull();
    expect(document.querySelector(".chart__value")?.textContent).toBe("Non disponible");
    expect(screen.getByText("Pas de référence")).toBeTruthy();
  });

  it("marque d'un point une valeur isolée, que la courbe ne pourrait pas relier", async () => {
    const sparse = {
      ...fixtures.TREND,
      points: fixtures.TREND.points.map((point, index) => ({ ...point, value: index === 3 ? 0.104 : null })),
    };
    await openApp(mockApi({ "GET /admin/analytics/trend": () => ({ data: sparse }) }), "#/analytics");
    await heading("Analytique");
    await screen.findByText("Taux d'engagement");

    expect(document.querySelectorAll(".chart__point")).toHaveLength(1);
    expect(screen.queryByText("Pas assez de données sur cette période.")).toBeNull();
  });

  it("change d'indicateur, de période et de sentiment en relançant la requête", async () => {
    const api = mockApi();
    await openApp(api, "#/analytics");
    await heading("Analytique");
    await screen.findByText("Taux d'engagement");

    // Le sentiment ne s'applique pas à l'engagement : les pastilles sont inactives.
    expect(screen.getByRole("button", { name: "Négatifs" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Temps de réponse" }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/analytics/trend")?.query.metric).toBe("response_time"));
    expect(screen.getByRole("button", { name: "Négatifs" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "90 j" }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/analytics/trend")?.query.period).toBe("90d"));

    fireEvent.click(screen.getByRole("button", { name: "Négatifs" }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/analytics/trend")?.query.sentiment).toBe("negative"));
    expect(lastCall(api, "GET", "/admin/analytics/pages")?.query.period).toBe("90d");
  });

  it("filtre par page avec les pages réelles du serveur", async () => {
    const api = mockApi();
    await openApp(api, "#/analytics");
    await heading("Analytique");
    const select = (await screen.findByRole("combobox", { name: "Filtrer par page" })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    expect(within(select).getByRole("option", { name: "Aurora Travel (IG)" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "p2" } });
    await waitFor(() => expect(lastCall(api, "GET", "/admin/analytics/trend")?.query.pageId).toBe("p2"));
    expect(lastCall(api, "GET", "/admin/analytics/pages")?.query.pageId).toBe("p2");
  });

  it("affiche le tableau par page, les mesures manquantes et le pic d'activité", async () => {
    await openApp(mockApi(), "#/analytics");
    await heading("Analytique");
    const table = within(await screen.findByRole("table", { name: "Performance par page" }));

    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const nova = within(rows[0] as HTMLElement);
    expect(nova.getByText("Nova Cosmetics")).toBeTruthy();
    expect(nova.getByText("4 821")).toBeTruthy();
    expect(nova.getByText("2 min 40 s")).toBeTruthy();
    expect(nova.getByText("74 %")).toBeTruthy();
    expect(nova.getByText("78")).toBeTruthy();

    const aurora = within(rows[1] as HTMLElement);
    expect(aurora.getByText("12 min 30 s").className).toContain("slow");
    expect(aurora.getByText("Non disponible")).toBeTruthy(); // part IA inconnue

    // Aucune donnée : « Non disponible » partout, jamais 0 % ni 0 min.
    const empty = within(rows[2] as HTMLElement);
    expect(empty.getAllByText("Non disponible")).toHaveLength(3);

    expect(screen.getByText("Pic à 14 h : 12,4 commentaires par heure en moyenne.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
describe("utilisateurs et rôles", () => {
  const paged = (total: number): UserList => ({ ...fixtures.USER_LIST, total });

  it("liste les comptes du serveur avec rôle, pages et dernière activité", async () => {
    await openApp(mockApi(), "#/users");
    await heading("Utilisateurs et rôles");

    expect(await screen.findByText("Nadia Belhadj")).toBeTruthy();
    expect(screen.getByText("4 comptes · 2 en ligne · les rôles s'appliquent à l'application mobile")).toBeTruthy();
    const row = (name: string) => within(screen.getByRole("button", { name: `Ouvrir ${name}` }));
    expect(row("Amine Rahali").getByText("Administrateur de la plateforme")).toBeTruthy();
    expect(row("Nadia Belhadj").getByText("Community manager")).toBeTruthy();
    expect(row("Nadia Belhadj").getByText("2 pages")).toBeTruthy();
    expect(row("Léa Martin").getByText("Propriétaire")).toBeTruthy();
    expect(row("Thomas Weber").getByText("jamais connecté")).toBeTruthy();
    expect(row("Thomas Weber").getByTitle("Suspendu")).toBeTruthy();
    expect(row("Amine Rahali").getByText("—")).toBeTruthy(); // aucune page, aucune marque
    // Pas d'invitation : le serveur n'en a pas.
    expect(screen.queryByRole("button", { name: /Inviter/ })).toBeNull();
  });

  it("filtre par statut et par recherche côté serveur", async () => {
    const api = mockApi();
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    await screen.findByText("Nadia Belhadj");

    const filters = within(screen.getByRole("group", { name: "Filtrer par statut" }));
    expect(filters.getByRole("button", { name: /Suspendus/ }).textContent).toContain("1");
    fireEvent.click(filters.getByRole("button", { name: /Suspendus/ }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/users")?.query.status).toBe("suspended"));

    fireEvent.change(screen.getByLabelText("Filtrer les membres par nom ou e-mail"), { target: { value: "thom" } });
    await waitFor(() => expect(lastCall(api, "GET", "/admin/users")?.query.q).toBe("thom"), { timeout: 2000 });
    // La frappe n'a pas déclenché une requête par lettre.
    expect(api.callsTo("GET", "/admin/users").filter((call) => call.query.q?.length === 1)).toHaveLength(0);
  });

  it("pagine quand il y a plus de comptes qu'une page", async () => {
    const api = mockApi({ "GET /admin/users": () => ({ data: paged(60) }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    expect(await screen.findByText("Page 1 sur 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Précédent" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/users")?.query.page).toBe("2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeTruthy();
  });

  it("modifie le rôle par marque depuis le tiroir, en une seule requête", async () => {
    const updated = { ...fixtures.USERS[2]!, memberships: [fixtures.USERS[2]!.memberships[0]!, { brandId: "b2", brandName: "Nova Cosmetics", role: "community_manager" as const }] };
    const api = mockApi({ "PATCH /admin/users/u-lea": () => ({ data: updated }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Léa Martin" }));

    const drawer = within(screen.getByRole("dialog", { name: nb("Léa Martin : rôles et accès") }));
    // Le propriétaire n'est pas modifiable ici.
    expect(drawer.getByText("Propriétaire : ce rôle ne peut pas être modifié ici.")).toBeTruthy();
    const novaRoles = within(drawer.getByRole("group", { name: "Nova Cosmetics" }));
    expect(novaRoles.getByRole("button", { name: "Lecteur" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(novaRoles.getByRole("button", { name: "Community manager" }));
    fireEvent.click(drawer.getByRole("button", { name: "Enregistrer" }));

    expect((await screen.findAllByText("Modifications enregistrées")).length).toBeGreaterThan(0);
    expect(lastCall(api, "PATCH", "/admin/users/u-lea")?.body).toEqual({ memberships: [{ brandId: "b2", role: "community_manager" }] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("n'envoie rien quand rien n'a changé", async () => {
    const api = mockApi();
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Nadia Belhadj" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enregistrer" }));

    expect((await screen.findAllByText("Aucune modification à enregistrer")).length).toBeGreaterThan(0);
    expect(api.callsTo("PATCH", "/admin/users/u-nadia")).toHaveLength(0);
  });

  it("accorde l'accès à la plateforme", async () => {
    const api = mockApi({ "PATCH /admin/users/u-nadia": () => ({ data: { ...fixtures.USERS[1]!, platformRole: "platform_admin" } }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Nadia Belhadj" }));

    const drawer = within(screen.getByRole("dialog"));
    fireEvent.click(drawer.getByRole("switch", { name: "Administrateur de la plateforme" }));
    fireEvent.click(drawer.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(lastCall(api, "PATCH", "/admin/users/u-nadia")?.body).toEqual({ platformRole: "platform_admin" }));
  });

  it("suspend un compte, puis relit la liste", async () => {
    const api = mockApi({ "PATCH /admin/users/u-nadia": () => ({ data: { ...fixtures.USERS[1]!, status: "suspended" } }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Nadia Belhadj" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspendre" }));

    expect((await screen.findAllByText("Compte suspendu · sessions fermées")).length).toBeGreaterThan(0);
    expect(lastCall(api, "PATCH", "/admin/users/u-nadia")?.body).toEqual({ status: "suspended" });
    await waitFor(() => expect(api.callsTo("GET", "/admin/users").length).toBeGreaterThan(1));
  });

  it("propose de réactiver un compte suspendu", async () => {
    const api = mockApi({ "PATCH /admin/users/u-thomas": () => ({ data: { ...fixtures.USERS[3]!, status: "active" } }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Thomas Weber" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Réactiver" }));

    expect((await screen.findAllByText("Compte réactivé")).length).toBeGreaterThan(0);
    expect(lastCall(api, "PATCH", "/admin/users/u-thomas")?.body).toEqual({ status: "active" });
  });

  it("empêche un administrateur de se suspendre lui-même", async () => {
    await openApp(mockApi(), "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Amine Rahali" }));

    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByRole("button", { name: "Suspendre" }).hasAttribute("disabled")).toBe(true);
    expect(drawer.getByText(/C'est votre compte/)).toBeTruthy();
    expect(drawer.getByText("Ce compte n'est membre d'aucune marque.")).toBeTruthy();
  });

  it("garde le tiroir ouvert et explique l'erreur quand le serveur refuse", async () => {
    const api = mockApi({ "PATCH /admin/users/u-nadia": () => ({ status: 409, error: { code: "conflict" } }) });
    await openApp(api, "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Nadia Belhadj" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Suspendre" }));

    expect((await screen.findAllByText("Action impossible dans l'état actuel. Actualisez les données puis réessayez.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("ferme le tiroir avec Échap", async () => {
    await openApp(mockApi(), "#/users");
    await heading("Utilisateurs et rôles");
    fireEvent.click(await screen.findByRole("button", { name: "Ouvrir Nadia Belhadj" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
describe("pages connectées", () => {
  it("affiche les pages réelles : état, arriéré, équipe, jeton", async () => {
    await openApp(mockApi(), "#/pages");
    await heading("Pages connectées");

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);

    const nova = within(cards[0] as HTMLElement);
    expect(nova.getByText("Nova Cosmetics")).toBeTruthy();
    expect(nova.getByText("@novacosmetics · 412 000 abonnés")).toBeTruthy();
    expect(nova.getByText("Saine")).toBeTruthy();
    expect(nova.getByText("1 284")).toBeTruthy();
    expect(nova.getByText("2 managers")).toBeTruthy();
    expect(nova.getByText("Marque : Nova Cosmetics SAS · Connectée par Léa Martin")).toBeTruthy();
    expect(nova.getByText("Jeton valable jusqu'au dimanche 14 mars 2027")).toBeTruthy();

    const aurora = within(cards[1] as HTMLElement);
    expect(aurora.getByText("Action requise")).toBeTruthy();
    expect(aurora.getByText("Abonnés non disponibles")).toBeTruthy();
    expect(aurora.getByText("Aucun manager")).toBeTruthy();
    expect(aurora.getByText("88").getAttribute("data-tone")).toBe("danger"); // arriéré au-delà du seuil critique
    expect(aurora.getByText("Reconnexion requise : Invalid OAuth access token")).toBeTruthy();
  });

  it("montre l'état de l'import des publications, et seulement pour une page Facebook", async () => {
    await openApp(mockApi(), "#/pages");
    await heading("Pages connectées");

    const [nova, aurora] = (await screen.findAllByRole("article")).map((card) => within(card as HTMLElement));
    // « il y a … » dépend de l'heure d'exécution : on vérifie tout sauf la durée relative.
    expect(nova?.getByText(/^42 publications · synchronisées /)).toBeTruthy();
    // Instagram : graph-api ne lit pas encore son fil, aucune action proposée.
    expect(aurora?.queryByRole("button", { name: /Synchroniser/ })).toBeNull();
  });

  it("dit qu'un historique n'a jamais été importé plutôt que d'afficher une date inventée", async () => {
    const never = { ...fixtures.PAGES.items[0]!, lastPostsSyncAt: null, postsCount: 1 };
    await openApp(mockApi({ "GET /admin/pages": () => ({ data: { ...fixtures.PAGES, items: [never] } }) }), "#/pages");
    await heading("Pages connectées");

    expect(await screen.findByText("Historique non importé · 1 publication connue")).toBeTruthy();
  });

  it("lance la synchronisation des publications d'une page", async () => {
    const api = mockApi({ "POST /admin/pages/p1/sync": () => ({ status: 202, data: { status: "queued" } }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");

    fireEvent.click(await screen.findByRole("button", { name: "Synchroniser les publications de Nova Cosmetics" }));

    await waitFor(() => expect(lastCall(api, "POST", "/admin/pages/p1/sync")).toBeTruthy());
    expect((await screen.findAllByText("Synchronisation des publications lancée · Nova Cosmetics")).length).toBeGreaterThan(0);
  });

  it("prévient quand une synchronisation vient déjà d'être demandée", async () => {
    const api = mockApi({ "POST /admin/pages/p1/sync": () => ({ status: 202, data: { status: "already_queued" } }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");

    fireEvent.click(await screen.findByRole("button", { name: "Synchroniser les publications de Nova Cosmetics" }));

    expect((await screen.findAllByText("Une synchronisation vient déjà d'être demandée · Nova Cosmetics")).length).toBeGreaterThan(0);
  });

  it("montre l'erreur du serveur et réactive le bouton quand la synchronisation échoue", async () => {
    const api = mockApi({ "POST /admin/pages/p1/sync": () => ({ status: 503, error: { code: "provider_unavailable" } }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");

    const button = await screen.findByRole("button", { name: "Synchroniser les publications de Nova Cosmetics" });
    fireEvent.click(button);

    await waitFor(() => expect(lastCall(api, "POST", "/admin/pages/p1/sync")).toBeTruthy());
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Synchronisation des publications lancée · Nova Cosmetics")).toBeNull();
  });

  it("ne propose pas de synchroniser une page Facebook à reconnecter", async () => {
    const expired = { ...fixtures.PAGES.items[0]!, status: "action_required" as const, rawStatus: "reauth_required" };
    await openApp(mockApi({ "GET /admin/pages": () => ({ data: { ...fixtures.PAGES, items: [expired] } }) }), "#/pages");
    await heading("Pages connectées");

    const button = await screen.findByRole("button", { name: "Synchroniser les publications de Nova Cosmetics" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("active la réponse automatique d'une page puis la coupe", async () => {
    const api = mockApi({ "PATCH /admin/pages/p1": (call) => ({ data: { id: "p1", autoReply: (call.body as { autoReply: boolean }).autoReply } }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");

    const toggle = await screen.findByRole("switch", { name: "Réponse automatique sur Nova Cosmetics (Facebook)" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(lastCall(api, "PATCH", "/admin/pages/p1")?.body).toEqual({ autoReply: false }));
    expect((await screen.findAllByText("Réponse automatique désactivée · Nova Cosmetics")).length).toBeGreaterThan(0);
  });

  it("revient à l'état du serveur quand l'enregistrement échoue", async () => {
    await openApp(mockApi({ "PATCH /admin/pages/p1": () => ({ status: 500, error: { code: "internal_error" } }) }), "#/pages");
    await heading("Pages connectées");

    const toggle = await screen.findByRole("switch", { name: "Réponse automatique sur Nova Cosmetics (Facebook)" });
    fireEvent.click(toggle);
    expect((await screen.findAllByText("Une erreur est survenue. Réessayez.")).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Réponse automatique sur Nova Cosmetics (Facebook)" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("dit quand aucune page n'est connectée", async () => {
    await openApp(mockApi({ "GET /admin/pages": () => ({ data: { items: [], totals: { all: 0, facebook: 0, instagram: 0 } } }) }), "#/pages");
    await heading("Pages connectées");
    expect(await screen.findByText("Aucune page connectée. Utilisez « Connecter une page Facebook » pour en lier une à un compte.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
describe("configuration", () => {
  it("affiche les mots-clés, les niveaux de service et l'avertissement sur leur application", async () => {
    await openApp(mockApi(), "#/configuration");
    await heading("Configuration");

    expect(await screen.findByText("remboursement")).toBeTruthy();
    expect(screen.getByText("arnaque")).toBeTruthy();
    expect(screen.getByText("Liste enregistrée pour la modération. Elle n'est pas encore appliquée automatiquement aux commentaires.")).toBeTruthy();
    expect(screen.getByText("15 min")).toBeTruthy();
    expect(screen.getByText("45 min")).toBeTruthy();
    expect(screen.getByText("30 min")).toBeTruthy();
  });

  it("ajoute un mot-clé normalisé et le confirme", async () => {
    const api = mockApi({ "POST /admin/settings/keywords": () => ({ status: 201, data: { keywords: ["remboursement", "arnaque", "boycott"] } }) });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    fireEvent.change(screen.getByLabelText("Nouveau mot-clé de modération"), { target: { value: "  Boycott " } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect((await screen.findAllByText("Mot-clé « boycott » ajouté au filtre")).length).toBeGreaterThan(0);
    expect(lastCall(api, "POST", "/admin/settings/keywords")?.body).toEqual({ word: "boycott" });
    expect(screen.getByText("boycott")).toBeTruthy();
    expect((screen.getByLabelText("Nouveau mot-clé de modération") as HTMLInputElement).value).toBe("");
  });

  it("n'envoie pas un mot-clé déjà présent", async () => {
    const api = mockApi();
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    fireEvent.change(screen.getByLabelText("Nouveau mot-clé de modération"), { target: { value: "ARNAQUE" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect((await screen.findAllByText("« arnaque » est déjà dans le filtre")).length).toBeGreaterThan(0);
    expect(api.callsTo("POST", "/admin/settings/keywords")).toHaveLength(0);
  });

  it("gère un doublon créé entre-temps par un autre administrateur", async () => {
    const api = mockApi({ "POST /admin/settings/keywords": () => ({ status: 409, error: { code: "conflict" } }) });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    fireEvent.change(screen.getByLabelText("Nouveau mot-clé de modération"), { target: { value: "boycott" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));

    expect((await screen.findAllByText("« boycott » est déjà dans le filtre")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.callsTo("GET", "/admin/settings").length).toBeGreaterThan(1));
  });

  it("retire un mot-clé", async () => {
    const api = mockApi({ "DELETE /admin/settings/keywords/arnaque": () => ({ data: { keywords: ["remboursement"] } }) });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    fireEvent.click(screen.getByRole("button", { name: "Retirer le mot-clé arnaque" }));

    await waitFor(() => expect(screen.queryByText("arnaque")).toBeNull());
    expect(api.callsTo("DELETE", "/admin/settings/keywords/arnaque")).toHaveLength(1);
    expect((await screen.findAllByText("Mot-clé « arnaque » retiré du filtre")).length).toBeGreaterThan(0);
  });

  it("règle un niveau de service par pas de 5 minutes et l'enregistre en quittant l'écran", async () => {
    const api = mockApi({ "PATCH /admin/settings/service-levels": () => ({ data: { serviceLevels: fixtures.SETTINGS.serviceLevels } }) });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    const increase = screen.getByRole("button", { name: nb("Augmenter : Délai de première réponse") });
    fireEvent.click(increase);
    fireEvent.click(increase);
    expect(screen.getByText("25 min")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: nb("Diminuer : Délai d'escalade") }));
    expect(screen.getByText("40 min")).toBeTruthy();

    navigate("overview");
    await waitFor(() => expect(api.callsTo("PATCH", "/admin/settings/service-levels")).toHaveLength(1));
    expect(lastCall(api, "PATCH", "/admin/settings/service-levels")?.body).toEqual({ firstResponseMinutes: 25, escalationMinutes: 40 });
  });

  it("ne descend jamais sous le minimum de 5 minutes", async () => {
    const api = mockApi({
      "GET /admin/settings": () => ({ data: { ...fixtures.SETTINGS, serviceLevels: { firstResponseMinutes: 5, escalationMinutes: 45, nightWindowMinutes: 30 } } }),
    });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("arnaque");

    fireEvent.click(screen.getByRole("button", { name: nb("Diminuer : Délai de première réponse") }));
    expect(screen.getByText("5 min")).toBeTruthy();
    navigate("overview");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.callsTo("PATCH", "/admin/settings/service-levels")).toHaveLength(0);
  });

  it("raconte le journal d'audit en français : événement, famille, auteur", async () => {
    await openApp(mockApi(), "#/configuration");
    await heading("Configuration");

    expect(await screen.findByText("Amel Haddad : rôle Community manager → Administrateur sur Studio Vega")).toBeTruthy();
    expect(screen.getByText("Seuil d'autonomie 78 % → 82 %")).toBeTruthy();
    expect(screen.getByText("Page Instagram déconnectée")).toBeTruthy();
    expect(screen.getByText("RÔLE")).toBeTruthy();
    expect(screen.getByText("IA")).toBeTruthy();
    expect(screen.getByText("PAGE")).toBeTruthy();
    expect(screen.getAllByText("Amine Rahali").length).toBeGreaterThan(1);
    // Un événement sans auteur est attribué au système plutôt que laissé vide.
    expect(screen.getByText("Système")).toBeTruthy();
    expect(screen.getByText("3 événements")).toBeTruthy();
  });

  it("charge la suite du journal à la demande", async () => {
    const page = (n: number) => ({ ...fixtures.AUDIT, page: n, total: 45, items: fixtures.AUDIT.items.map((item) => ({ ...item, id: `${item.id}-p${n}` })) });
    const api = mockApi({ "GET /admin/audit": (call) => ({ data: page(Number(call.query.page)) }) });
    await openApp(api, "#/configuration");
    await heading("Configuration");
    await screen.findByText("45 événements");

    fireEvent.click(screen.getByRole("button", { name: "Afficher plus" }));
    await waitFor(() => expect(lastCall(api, "GET", "/admin/audit")?.query.page).toBe("2"));
    await waitFor(() => expect(screen.getAllByText("Page Instagram déconnectée")).toHaveLength(2));
  });

  it("dit qu'il n'y a encore aucun événement d'administration", async () => {
    await openApp(mockApi({ "GET /admin/audit": () => ({ data: { items: [], page: 1, pageSize: 20, total: 0 } }) }), "#/configuration");
    await heading("Configuration");
    expect(await screen.findByText("Aucun événement d'administration pour le moment.")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
describe("connexion d'un compte utilisateur à une page Facebook", () => {
  const SELECTION = fixtures.SELECTION_ID;
  const RETURN_HASH = `#/pages?status=select&selection=${SELECTION}`;

  beforeEach(() => vi.mocked(redirectTo).mockClear());

  /** Ouvre la console sur le retour de Facebook et attend que les pages proposées soient affichées. */
  async function selectionDialog(api: Api, name = "Choisir les pages à lier") {
    await openApp(api, RETURN_HASH);
    const dialog = within(await screen.findByRole("dialog", { name }));
    await dialog.findAllByRole("checkbox");
    return dialog;
  }

  it("se lance depuis l'en-tête ou depuis la tuile, et n'est plus « réservée au mobile »", async () => {
    await openApp(mockApi(), "#/pages");
    await heading("Pages connectées");
    await screen.findAllByRole("article");

    expect(screen.getByRole("button", { name: "Connecter une page Facebook" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Connecter une page Lier une page Facebook/ }));
    expect(screen.getByRole("dialog", { name: "Connecter une page Facebook" })).toBeTruthy();
    expect(screen.queryByText(/depuis l'application mobile/)).toBeNull();
  });

  it("montre au nom de quel compte chaque page a été liée", async () => {
    await openApp(mockApi(), "#/pages");
    await heading("Pages connectées");
    const [nova, aurora] = await screen.findAllByRole("article");
    expect(within(nova as HTMLElement).getByText("Marque : Nova Cosmetics SAS · Connectée par Léa Martin")).toBeTruthy();
    // Compte disparu : la ligne ne l'invente pas.
    expect(within(aurora as HTMLElement).getByText("Marque : Aurora")).toBeTruthy();
  });

  it("ne propose que les comptes propriétaires ou administrateurs d'une marque, puis redirige vers Facebook", async () => {
    const api = mockApi();
    await openApp(api, "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));

    const dialog = within(screen.getByRole("dialog"));
    // Léa (propriétaire) : oui. Nadia (community manager) et l'administrateur sans marque : non.
    expect(await dialog.findByRole("radio", { name: /Léa Martin/ })).toBeTruthy();
    expect(dialog.queryByRole("radio", { name: /Nadia Belhadj/ })).toBeNull();
    expect(dialog.queryByRole("radio", { name: /Amine Rahali/ })).toBeNull();
    expect(lastCall(api, "GET", "/admin/users")?.query).toEqual({ status: "active", page: "1", pageSize: "20" });

    const submit = dialog.getByRole("button", { name: "Continuer vers Facebook" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.click(dialog.getByRole("radio", { name: /Léa Martin/ }));
    // Seule la marque où Léa est propriétaire est offerte (elle n'est que lectrice de l'autre).
    const brand = dialog.getByLabelText("Marque") as HTMLSelectElement;
    expect(within(brand).getAllByRole("option").map((option) => option.textContent)).toEqual(["Studio Vega · Propriétaire"]);
    expect(brand.value).toBe("b1");
    expect(submit.hasAttribute("disabled")).toBe(false);

    fireEvent.click(submit);

    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://www.facebook.com/v25.0/dialog/oauth?state=abc"));
    expect(lastCall(api, "POST", "/admin/pages/connect")?.body).toEqual({ userId: "u-lea", brandId: "b1" });
    expect(dialog.getByRole("button", { name: "Redirection vers Facebook…" }).hasAttribute("disabled")).toBe(true);
  });

  it("cherche le compte côté serveur, après la frappe", async () => {
    const api = mockApi();
    await openApp(api, "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));

    fireEvent.change(screen.getByLabelText("Rechercher un compte utilisateur"), { target: { value: "léa" } });
    await waitFor(() => expect(lastCall(api, "GET", "/admin/users")?.query.q).toBe("léa"), { timeout: 2000 });
  });

  it("fait choisir la marque quand le compte en administre plusieurs", async () => {
    const twoBrands = {
      ...fixtures.USER_LIST,
      items: [
        {
          ...fixtures.USERS[1]!,
          id: "u-multi",
          name: "Sofia Multi",
          role: "owner" as const,
          memberships: [
            { brandId: "b1", brandName: "Studio Vega", role: "owner" as const },
            { brandId: "b9", brandName: "Maison Verte", role: "admin" as const },
            { brandId: "b8", brandName: "Simple lecteur", role: "viewer" as const },
          ],
        },
      ],
    };
    const api = mockApi({ "GET /admin/users": () => ({ data: twoBrands }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));

    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(await dialog.findByRole("radio", { name: /Sofia Multi/ }));
    const brand = dialog.getByLabelText("Marque") as HTMLSelectElement;
    expect(brand.value).toBe("");
    expect(dialog.getByRole("button", { name: "Continuer vers Facebook" }).hasAttribute("disabled")).toBe(true);
    expect(within(brand).queryByRole("option", { name: /Simple lecteur/ })).toBeNull();

    fireEvent.change(brand, { target: { value: "b9" } });
    fireEvent.click(dialog.getByRole("button", { name: "Continuer vers Facebook" }));
    await waitFor(() => expect(lastCall(api, "POST", "/admin/pages/connect")?.body).toEqual({ userId: "u-multi", brandId: "b9" }));
  });

  it("dit qu'aucun compte ne convient plutôt que d'afficher une liste vide", async () => {
    await openApp(mockApi({ "GET /admin/users": () => ({ data: { ...fixtures.USER_LIST, items: [fixtures.USERS[1]!] } }) }), "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));
    expect(await screen.findByText("Aucun compte propriétaire ou administrateur d'une marque ne correspond.")).toBeTruthy();
  });

  it("explique l'erreur quand la connexion à Facebook n'est pas configurée, et laisse réessayer", async () => {
    const api = mockApi({ "POST /admin/pages/connect": () => ({ status: 503, error: { code: "provider_unavailable" } }) });
    await openApp(api, "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(await dialog.findByRole("radio", { name: /Léa Martin/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Continuer vers Facebook" }));

    expect((await dialog.findByRole("alert")).textContent).toBe(
      "La connexion aux réseaux sociaux est indisponible. Vérifiez que l'application Meta est configurée.",
    );
    expect(redirectTo).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: "Continuer vers Facebook" }).hasAttribute("disabled")).toBe(false);
  });

  it("ferme la fenêtre avec Échap", async () => {
    await openApp(mockApi(), "#/pages");
    await heading("Pages connectées");
    fireEvent.click(await screen.findByRole("button", { name: "Connecter une page Facebook" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // --- Retour de Facebook ------------------------------------------------------------------------

  it("propose au retour les pages du compte Facebook, sans rien lier d'office", async () => {
    const api = mockApi();
    const dialog = await selectionDialog(api);
    expect(
      dialog.getByText("Ce compte Facebook gère les pages ci-dessous. Seules celles que vous cochez seront liées à la marque « Studio Vega », au nom de Léa Martin."),
    ).toBeTruthy();
    expect(dialog.getAllByRole("checkbox")).toHaveLength(3);
    expect(dialog.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(dialog.getByRole("button", { name: "Lier les pages cochées" }).hasAttribute("disabled")).toBe(true);
    expect(api.callsTo("POST", `/admin/pages/connect/selections/${SELECTION}/link`)).toHaveLength(0);
    // L'adresse est nettoyée : recharger la page ne rouvre pas la sélection.
    expect(window.location.hash).toBe("#/pages");
  });

  it("interdit une page déjà liée à une autre marque et signale une reconnexion", async () => {
    const dialog = await selectionDialog(mockApi());

    const elsewhere = dialog.getByRole("checkbox", { name: /Page d'un autre client/ }) as HTMLInputElement;
    expect(elsewhere.disabled).toBe(true);
    expect(dialog.getByText("Déjà liée à la marque « Aurora » : déconnectez-la d'abord de cette marque")).toBeTruthy();
    expect(dialog.getByText("Déjà liée à cette marque : son jeton sera renouvelé")).toBeTruthy();
    expect(dialog.getByText("Instagram lié : @nouvelle.page")).toBeTruthy();
  });

  it("retombe sur la pastille « f » quand l'image d'une page ne charge pas", async () => {
    const withPicture = {
      ...fixtures.SELECTION,
      pages: fixtures.SELECTION.pages.map((page, index) => (index === 0 ? { ...page, pictureUrl: "https://cdn.example/nouvelle.png" } : page)),
    };
    const dialog = await selectionDialog(
      mockApi({ [`GET /admin/pages/connect/selections/${SELECTION}`]: () => ({ data: withPicture }) }),
    );

    const row = dialog.getByRole("checkbox", { name: /Nouvelle page/ }).closest("label") as HTMLElement;
    const image = row.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://cdn.example/nouvelle.png");

    fireEvent.error(image);
    expect(row.querySelector("img")).toBeNull();
    expect(row.querySelector(".sel-row__avatar--none")).not.toBeNull();
  });

  it("lie uniquement les pages cochées, confirme et recharge la liste", async () => {
    const api = mockApi();
    const dialog = await selectionDialog(api);

    fireEvent.click(dialog.getByRole("checkbox", { name: /Nouvelle page/ }));
    fireEvent.click(dialog.getByRole("checkbox", { name: /Page déjà liée ici/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Lier 2 pages" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(lastCall(api, "POST", `/admin/pages/connect/selections/${SELECTION}/link`)?.body).toEqual({ pageIds: ["111", "333"] });
    expect((await screen.findAllByText("2 comptes liés à la marque « Studio Vega »")).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.callsTo("GET", "/admin/pages").length).toBeGreaterThan(1));
  });

  it("garde la fenêtre ouverte et explique le refus quand une page vient d'être liée ailleurs", async () => {
    const api = mockApi({
      [`POST /admin/pages/connect/selections/${SELECTION}/link`]: () => ({ status: 409, error: { code: "conflict" } }),
    });
    const dialog = await selectionDialog(api);
    fireEvent.click(dialog.getByRole("checkbox", { name: /Nouvelle page/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Lier 1 page" }));

    expect((await dialog.findByRole("alert")).textContent).toBe(
      "Action impossible dans l'état actuel. Actualisez les données puis réessayez.",
    );
    expect(dialog.getByRole("button", { name: "Lier 1 page" }).hasAttribute("disabled")).toBe(false);
  });

  it("dit que la sélection a expiré plutôt que d'afficher une erreur technique", async () => {
    const api = mockApi({
      [`GET /admin/pages/connect/selections/${SELECTION}`]: () => ({ status: 404, error: { code: "not_found" } }),
    });
    await openApp(api, RETURN_HASH);
    const dialog = within(await screen.findByRole("dialog", { name: "Choisir les pages à lier" }));
    expect((await dialog.findByRole("alert")).textContent).toBe(
      "Cette sélection a expiré ou a déjà été utilisée. Relancez la connexion pour en obtenir une nouvelle.",
    );
    expect(dialog.queryByRole("button", { name: /^Lier/ })).toBeNull();
  });

  it("affiche la raison quand Facebook n'a pas abouti, puis nettoie l'adresse", async () => {
    await openApp(mockApi(), "#/pages?status=error&reason=permission_denied");
    await heading("Pages connectées");

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("Facebook n'a pas reçu toutes les autorisations nécessaires.");
    expect(window.location.hash).toBe("#/pages");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(banner).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retombe sur un message générique pour une raison inconnue", async () => {
    await openApp(mockApi(), "#/pages?status=error&reason=quelque_chose_de_neuf");
    expect((await screen.findByRole("alert")).textContent).toContain("La connexion à Facebook n'a pas abouti. Réessayez.");
  });

  it("reprend la liaison après une reconnexion : l'adresse de retour survit à l'écran de connexion", async () => {
    mockApi();
    window.location.hash = RETURN_HASH;
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Adresse e-mail"), { target: { value: "admin@hootly.app" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "ChangeMe123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("dialog", { name: "Choisir les pages à lier" }, { timeout: 3000 })).toBeTruthy();
    expect(window.location.hash).toBe("#/pages");
  });

  it("parle anglais quand la langue le demande", async () => {
    window.localStorage.setItem("pulse.locale", "en");
    const dialog = await selectionDialog(mockApi(), "Choose the pages to link");
    expect(dialog.getByText("Already linked to this brand: its token will be renewed")).toBeTruthy();
    fireEvent.click(dialog.getByRole("checkbox", { name: /Nouvelle page/ }));
    expect(dialog.getByRole("button", { name: "Link 1 page" })).toBeTruthy();
  });
});
