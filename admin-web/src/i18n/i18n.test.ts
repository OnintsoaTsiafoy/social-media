import { describe, expect, it } from "vitest";

import { en } from "./en";
import { fr } from "./fr";
import { translate } from "./index";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("catalogues", () => {
  it("expose exactement les mêmes clés en français et en anglais", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });

  it("n'ont aucune traduction vide", () => {
    for (const [key, value] of [...Object.entries(fr), ...Object.entries(en)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("utilisent les mêmes paramètres dans les deux langues", () => {
    for (const key of Object.keys(fr) as Array<keyof typeof fr>) {
      expect(placeholders(en[key]), key).toEqual(placeholders(fr[key]));
    }
  });

  it("fournissent chaque pluriel en deux formes", () => {
    const bases = Object.keys(fr)
      .filter((key) => key.endsWith("_one"))
      .map((key) => key.replace(/_one$/, ""));
    expect(bases.length).toBeGreaterThan(5);
    for (const base of bases) {
      expect(fr, base).toHaveProperty(`${base}_other`);
      expect(en, base).toHaveProperty(`${base}_other`);
    }
  });
});

describe("translate", () => {
  it("traduit dans la langue demandée", () => {
    expect(translate("fr", "nav.overview")).toBe("Vue d'ensemble");
    expect(translate("en", "nav.overview")).toBe("Overview");
  });

  it("remplace les paramètres", () => {
    expect(translate("fr", "supervision.toast.published", { page: "Nova" })).toBe("Réponse publiée sur Nova");
    expect(translate("en", "supervision.toast.published", { page: "Nova" })).toBe("Reply published on Nova");
  });

  it("laisse un paramètre manquant visible plutôt que de l'effacer", () => {
    expect(translate("fr", "supervision.toast.published")).toContain("{page}");
  });

  it("accorde le pluriel : 0 et 1 sont singuliers en français, 0 est pluriel en anglais", () => {
    expect(translate("fr", "users.pages", { count: 0 })).toBe("0 page");
    expect(translate("fr", "users.pages", { count: 1 })).toBe("1 page");
    expect(translate("fr", "users.pages", { count: 2 })).toBe("2 pages");
    expect(translate("en", "users.pages", { count: 0 })).toBe("0 pages");
    expect(translate("en", "users.pages", { count: 1 })).toBe("1 page");
  });

  it("groupe les grands nombres avec une espace insécable", () => {
    expect(translate("fr", "users.pages", { count: 12480 })).toBe("12 480 pages");
  });

  it("applique la typographie française sans toucher à l'anglais", () => {
    const french = translate("fr", "keywords.added", { word: "arnaque" });
    expect(french).toBe("Mot-clé « arnaque » ajouté au filtre");
    expect(translate("fr", "autonomy.note.balanced", { share: "75 %" })).toContain("75 %");
    expect(translate("fr", "card.feedback.title")).toContain(" ?");
    expect(translate("en", "keywords.added", { word: "scam" })).toBe("Keyword “scam” added to the filter");
  });

  it("retombe sur la clé plutôt que d'afficher un écran vide quand elle est inconnue", () => {
    expect(translate("fr", "pas.une.cle" as never)).toBe("pas.une.cle");
  });
});
