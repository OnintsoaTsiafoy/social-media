import { describe, expect, it } from "vitest";

import { parseOAuthReturn } from "./usePageConnection";
import { screenFromHash } from "./useRoute";

describe("screenFromHash", () => {
  it("ignore la requête que Facebook ajoute au fragment", () => {
    expect(screenFromHash("#/pages")).toBe("pages");
    expect(screenFromHash("#/pages?status=select&selection=abc")).toBe("pages");
    expect(screenFromHash("#/users?q=léa")).toBe("users");
  });

  it("retombe sur la vue d'ensemble pour une route inconnue ou vide", () => {
    expect(screenFromHash("")).toBe("overview");
    expect(screenFromHash("#/nope?x=1")).toBe("overview");
  });
});

describe("parseOAuthReturn", () => {
  it("reconnaît le retour avec une sélection de pages", () => {
    expect(parseOAuthReturn("#/pages?status=select&network=facebook&selection=5e5e")).toEqual({
      kind: "select",
      selectionId: "5e5e",
    });
  });

  it("reconnaît une raison d'échec connue", () => {
    expect(parseOAuthReturn("#/pages?status=error&reason=incompatible_account")).toEqual({
      kind: "error",
      reason: "incompatible_account",
    });
  });

  it("ne laisse passer aucune raison arbitraire : elle devient « unknown »", () => {
    expect(parseOAuthReturn("#/pages?status=error&reason=<script>")).toEqual({ kind: "error", reason: "unknown" });
    expect(parseOAuthReturn("#/pages?status=error")).toEqual({ kind: "error", reason: "unknown" });
  });

  it("traite une sélection sans identifiant comme une erreur, pas comme un dialogue vide", () => {
    expect(parseOAuthReturn("#/pages?status=select")).toEqual({ kind: "error", reason: "unknown" });
  });

  it("ignore tout ce qui n'est pas un retour de Facebook", () => {
    expect(parseOAuthReturn("#/pages")).toBeNull();
    expect(parseOAuthReturn("#/pages?status=success&network=facebook")).toBeNull();
    expect(parseOAuthReturn("#/pages?foo=bar")).toBeNull();
    expect(parseOAuthReturn("")).toBeNull();
  });
});
