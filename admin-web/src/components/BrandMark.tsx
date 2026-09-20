/**
 * Marque Hootly : une chouette, en SVG inline.
 *
 * Inline plutôt qu'un fichier image : le logo suit la taille du texte qui
 * l'accompagne, reste net à toutes les densités d'écran et n'ajoute aucune
 * requête réseau. Les couleurs viennent des jetons de la palette
 * (`--night`, `--lime`) pour qu'un changement de thème n'oublie pas le logo.
 *
 * Purement décoratif : le nom du produit est déjà écrit à côté, donc
 * `aria-hidden` évite une annonce en double aux lecteurs d'écran.
 */
export function BrandMark({ className = "brand__mark" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="10" fill="var(--night)" />
      {/*
        Tête d'un seul tenant — aigrettes, face et menton dans le même tracé.
        Les yeux et le bec sont en réserve (couleur du fond) plutôt que posés
        par-dessus : à 16 px, des éléments séparés se détachent et le dessin
        cesse de se lire.
      */}
      <path
        d="M6.4 13.4 L8.8 6.6 L12.6 10.6 Q16 9.8 19.4 10.6 L23.2 6.6 L25.6 13.4
           C25.6 20.8 21.3 26.3 16 26.3 C10.7 26.3 6.4 20.8 6.4 13.4 Z"
        fill="var(--lime)"
      />
      {/* Grands yeux ronds, bien séparés : c'est le marqueur de la chouette,
          et accolés ils fusionneraient en un « oo ». */}
      <circle cx="12.2" cy="16" r="3.2" fill="var(--night)" />
      <circle cx="19.8" cy="16" r="3.2" fill="var(--night)" />
      {/* Bec */}
      <path d="M16 22.6 L14.5 19.9 H17.5 Z" fill="var(--night)" />
    </svg>
  );
}
