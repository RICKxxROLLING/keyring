import { useOutletContext } from "react-router-dom";
import type { PropertyDossier } from "../../shared/types";

/** DossierPage passes its fetched payload down via router outlet context; tabs read it here. */
export function useDossier(): PropertyDossier {
  return useOutletContext<PropertyDossier>();
}
