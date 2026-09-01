import { useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PropertyType, PropertyView } from "../../shared/types";
import { HERO_COLORS } from "../../shared/hero-colors";
import { apiPost, ApiClientError } from "../lib/api";
import { qk } from "../lib/query";
import { Button } from "../components/Button";
import { ErrorNotice, Field, Select, TextInput } from "../components/Form";
import { KeyGlyph } from "../components/KeyGlyph";

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "single_family", label: "Single family" },
  { value: "duplex", label: "Duplex" },
  { value: "triplex", label: "Triplex" },
  { value: "fourplex", label: "Fourplex" },
  { value: "condo", label: "Condo" },
  { value: "townhouse", label: "Townhouse" },
  { value: "other", label: "Other" },
];

/**
 * Cut a new key — add a property.
 *
 * The rail linked here before this page existed, so the button 404'd. Kept
 * deliberately short: only what the API actually requires, plus the hero
 * colour, because the point of "cut a new key" is to get a property onto the
 * ring in under a minute. Everything else is editable on the dossier
 * afterwards, and asking for it up front is how a quick-add turns into a form
 * nobody fills in.
 */
export function NewPropertyPage(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("single_family");
  // null means "let the server pick the least-used colour", which is the right
  // default — it keeps the ring evenly spread without anyone thinking about it.
  const [heroColor, setHeroColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost<PropertyView>("/api/properties", {
        name: name.trim(),
        addressLine1: addressLine1.trim(),
        city: city.trim(),
        state: state.trim(),
        postalCode: postalCode.trim(),
        propertyType,
        ...(heroColor ? { heroColor } : {}),
      }),
    onSuccess: (property) => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.properties });
      void navigate(`/p/${property.id}`, { replace: true });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Couldn't add the property.");
    },
  });

  const ready =
    name.trim() && addressLine1.trim() && city.trim() && state.trim() && postalCode.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <div style={{ paddingTop: 28, maxWidth: 620 }}>
      <h1 className="kr-display kr-h1" style={{ margin: 0 }}>
        Cut a new key
      </h1>
      <p style={{ margin: "10px 0 26px", fontSize: 15, color: "var(--ink-2)", maxWidth: 52 * 10 }}>
        Just enough to get it on the ring. Units, tenants and the rest come after.
      </p>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorNotice message={error} />
        </div>
      )}

      <form onSubmit={submit}>
        <Field label="Name" hint="What you call it — “Alder Street”, not the legal description.">
          <TextInput autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Street address">
          <TextInput
            required
            autoComplete="address-line1"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
          />
        </Field>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(140px, 100%), 1fr))" }}>
          <Field label="City">
            <TextInput
              required
              autoComplete="address-level2"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          <Field label="State">
            <TextInput
              required
              autoComplete="address-level1"
              maxLength={50}
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </Field>
          <Field label="ZIP">
            <TextInput
              required
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={20}
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Type">
          <Select
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
          <legend className="kr-field-label" style={{ padding: 0 }}>
            Key colour
          </legend>
          <p className="kr-field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Follows this property everywhere. Leave it on Automatic and the least-used
            colour is picked, so the ring stays easy to tell apart.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <ColorChoice
              label="Automatic"
              color={null}
              selected={heroColor === null}
              onSelect={() => setHeroColor(null)}
            />
            {HERO_COLORS.map((c) => (
              <ColorChoice
                key={c.id}
                label={c.name}
                color={c.value}
                selected={heroColor === c.value}
                onSelect={() => setHeroColor(c.value)}
              />
            ))}
          </div>
        </fieldset>

        <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
          <Button type="submit" disabled={!ready || create.isPending}>
            {create.isPending ? "Cutting…" : "Cut the key"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void navigate("/")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function ColorChoice(props: {
  label: string;
  color: string | null;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-pressed={props.selected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        padding: "6px 12px 6px 8px",
        borderRadius: 999,
        background: "var(--panel)",
        border: `1px solid ${props.selected ? "var(--ink-3)" : "var(--line)"}`,
        boxShadow: props.selected ? "0 0 0 2px var(--panel), 0 0 0 3px var(--ink-3)" : "none",
        color: "var(--ink)",
        fontSize: 13,
        fontWeight: props.selected ? 600 : 500,
      }}
    >
      <KeyGlyph color={props.color} size="card" />
      {props.label}
    </button>
  );
}
