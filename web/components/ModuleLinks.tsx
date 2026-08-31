import { Link, useParams } from "react-router-dom";
import type { ReactElement } from "react";
import type { PropertyDossier } from "../../shared/types";
import { hero } from "./KeyGlyph";

/**
 * The modules that are not one of the five designed tabs.
 *
 * The design shows five tabs; the app has eleven modules. Rather than delete
 * six features to make a tab bar look calm, they live here as a labelled grid
 * on Overview, each showing its own count so the panel is a status board and
 * not just a menu. Every route still works if bookmarked or linked.
 */
export function ModuleLinks({ dossier }: { dossier: PropertyDossier }): ReactElement {
  const { propertyId } = useParams<{ propertyId: string }>();
  const color = dossier.property.heroColor;
  const base = `/p/${propertyId ?? dossier.property.id}`;

  const modules = [
    { to: "notes", label: "Notes", count: dossier.notes.length },
    { to: "projects", label: "Projects", count: dossier.projects.length },
    { to: "specs", label: "The particulars", count: dossier.specs.length },
    { to: "compliance", label: "Compliance", count: dossier.compliance.length },
    { to: "turnover", label: "Turnover", count: dossier.turnovers.length },
    { to: "timeline", label: "Timeline", count: null },
  ];

  return (
    <section style={{ marginTop: 26 }}>
      <h2 className="kr-label" style={{ marginBottom: 10 }}>
        Also on this key
      </h2>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))",
        }}
      >
        {modules.map((m) => (
          <Link
            key={m.to}
            to={`${base}/${m.to}`}
            className="kr-module-link"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              minHeight: 52,
              padding: "12px 14px",
              borderRadius: 12,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            {m.label}
            {m.count !== null && (
              <span
                className="kr-label kr-tabular"
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: m.count > 0 ? hero.pill(color, 0.16) : "var(--panel-2)",
                  color: "var(--ink-2)",
                }}
              >
                {m.count}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
