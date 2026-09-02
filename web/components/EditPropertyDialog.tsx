import { useState, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PropertyType, PropertyView } from "../../shared/types";
import { HERO_COLORS } from "../../shared/hero-colors";
import { apiPatch, apiUpload, ApiClientError } from "../lib/api";
import { qk } from "../lib/query";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { ErrorNotice, Field, Select, TextInput } from "./Form";
import { KeyGlyph } from "./KeyGlyph";
import { MoneyInput, NumericInput } from "./NumericInput";

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
 * Everything about a property, after it is on the ring.
 *
 * "Cut a new key" asks for the minimum on purpose — the point is to get a
 * property onto the ring in under a minute — which left no way to fill in the
 * rest afterwards. The mortgage, the insurance policy, the parcel number and
 * the year built all existed in the schema and on the dossier, and none of
 * them could be entered or corrected once the key was cut.
 *
 * Sent as one PATCH carrying expectedVersion, so two people editing the same
 * property get a conflict rather than one silently overwriting the other. Empty
 * text fields become null rather than "": the dossier tests for absence to
 * decide whether to show a row, and an empty string is present.
 */
export function EditPropertyDialog(props: {
  property: PropertyView;
  open: boolean;
  onClose: () => void;
}): ReactElement | null {
  const p = props.property;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: p.name,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2 ?? "",
    city: p.city,
    state: p.state,
    postalCode: p.postalCode,
    propertyType: p.propertyType,
    yearBuilt: p.yearBuilt === null ? "" : String(p.yearBuilt),
    sqft: p.sqft === null ? "" : String(p.sqft),
    lotSqft: p.lotSqft === null ? "" : String(p.lotSqft),
    parcelNumber: p.parcelNumber ?? "",
    purchaseDate: p.purchaseDate ?? "",
    purchasePrice: p.purchasePriceCents === null ? "" : String(p.purchasePriceCents / 100),
    mortgageLender: p.mortgageLender ?? "",
    mortgagePayment: p.mortgagePaymentCents === null ? "" : String(p.mortgagePaymentCents / 100),
    insuranceCarrier: p.insuranceCarrier ?? "",
    insurancePolicyNumber: p.insurancePolicyNumber ?? "",
    notes: p.notes ?? "",
    heroColor: p.heroColor,
  });

  /**
   * The cover photo, carried in this form's state rather than saved on its own.
   *
   * The file is uploaded the moment it is chosen — that is what mints an id —
   * but the property is not touched until Save. Setting the cover with its own
   * PATCH would bump the property's version and make the version this dialog is
   * holding stale, so saving the rest of the form would then fail with a
   * conflict against an edit the same person had just made.
   */
  const [cover, setCover] = useState<{ id: string | null; url: string | null }>({
    id: p.coverUploadId,
    url: p.coverUrl,
  });

  const uploadCover = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      body.append("parentType", "property");
      body.append("parentId", p.id);
      return apiUpload("/api/uploads", body);
    },
    onSuccess: (u) => setCover({ id: u.id, url: u.thumbUrl ?? u.url }),
    onError: () => setError("Couldn't upload that image."),
  });

  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** "" -> null, so an emptied field genuinely clears rather than storing blank. */
  const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());
  const int = (v: string): number | null => {
    const n = Number(v.replace(/,/g, ""));
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n);
  };
  const cents = (v: string): number | null => {
    const n = Number(v.replace(/[$,]/g, ""));
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
  };

  const save = useMutation({
    mutationFn: () =>
      apiPatch<PropertyView>(`/api/properties/${p.id}`, {
        name: form.name.trim(),
        addressLine1: form.addressLine1.trim(),
        addressLine2: text(form.addressLine2),
        city: form.city.trim(),
        state: form.state.trim(),
        postalCode: form.postalCode.trim(),
        propertyType: form.propertyType,
        yearBuilt: int(form.yearBuilt),
        sqft: int(form.sqft),
        lotSqft: int(form.lotSqft),
        parcelNumber: text(form.parcelNumber),
        purchaseDate: text(form.purchaseDate),
        purchasePriceCents: cents(form.purchasePrice),
        mortgageLender: text(form.mortgageLender),
        mortgagePaymentCents: cents(form.mortgagePayment),
        insuranceCarrier: text(form.insuranceCarrier),
        insurancePolicyNumber: text(form.insurancePolicyNumber),
        notes: text(form.notes),
        heroColor: form.heroColor,
        coverUploadId: cover.id,
        expectedVersion: p.version,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dossier(p.id) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.properties });
      props.onClose();
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError
          ? err.code === "VERSION_CONFLICT"
            ? "Someone else changed this property while you had it open. Close this, take a look at their version, and make your change again."
            : err.message
          : "Couldn't save those details.",
      );
    },
  });

  if (!props.open) return null;

  const ready =
    form.name.trim() &&
    form.addressLine1.trim() &&
    form.city.trim() &&
    form.state.trim() &&
    form.postalCode.trim();

  return (
    <Dialog open onClose={props.onClose} title="Property details" wide>
      {error && (
        <div style={{ marginBottom: 14 }}>
          <ErrorNotice message={error} />
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate();
        }}
      >
        {/* First, because it is the thing you see on the card before you read
            a word of it. The card falls back to a striped plate without one. */}
        <section style={{ marginBottom: 18 }}>
          <h3 className="kr-label" style={{ margin: "0 0 8px" }}>
            Cover photo
          </h3>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div
              aria-hidden={cover.url ? undefined : true}
              style={{
                width: 168,
                height: 104,
                flex: "none",
                borderRadius: 12,
                border: "1px solid var(--line)",
                overflow: "hidden",
                background: cover.url
                  ? `center/cover no-repeat url(${JSON.stringify(cover.url)})`
                  : "repeating-linear-gradient(115deg, var(--panel-2) 0 9px, var(--line-soft) 9px 10px)",
              }}
            />
            <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <label
                className="kr-btn-secondary"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "0 14px",
                  minHeight: 40,
                  borderRadius: 10,
                  border: "1px solid var(--line)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {uploadCover.isPending ? "Uploading…" : cover.url ? "Replace photo" : "Upload a photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setError(null);
                      uploadCover.mutate(file);
                    }
                    // Let the same file be picked again after a failure.
                    e.target.value = "";
                  }}
                />
              </label>
              {cover.id && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCover({ id: null, url: null })}
                >
                  Remove cover
                </Button>
              )}
              <p className="kr-field-hint" style={{ margin: 0, maxWidth: "34ch" }}>
                Shown across the top of this property&apos;s card. The photo is filed under
                Papers too, and any image already there can be made the cover from that tab.
                Takes effect when you save.
              </p>
            </div>
          </div>
        </section>

        <Section title="What it is">
          <Field label="Name" hint="What you call it, not the legal description.">
            <TextInput value={form.name} onChange={(e) => field("name", e.target.value)} required />
          </Field>
          <Field label="Type">
            <Select
              value={form.propertyType}
              onChange={(e) => field("propertyType", e.target.value as PropertyType)}
            >
              {PROPERTY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Where it is">
          <Field label="Street address">
            <TextInput
              value={form.addressLine1}
              onChange={(e) => field("addressLine1", e.target.value)}
              required
            />
          </Field>
          <Field label="Unit / suite" hint="Optional.">
            <TextInput value={form.addressLine2} onChange={(e) => field("addressLine2", e.target.value)} />
          </Field>
          <Field label="City">
            <TextInput value={form.city} onChange={(e) => field("city", e.target.value)} required />
          </Field>
          <Field label="State">
            <TextInput value={form.state} onChange={(e) => field("state", e.target.value)} required />
          </Field>
          <Field label="ZIP">
            <TextInput
              value={form.postalCode}
              onChange={(e) => field("postalCode", e.target.value)}
              required
            />
          </Field>
          <Field label="Parcel number" hint="Optional.">
            <TextInput value={form.parcelNumber} onChange={(e) => field("parcelNumber", e.target.value)} />
          </Field>
        </Section>

        <Section title="The building">
          <Field label="Year built">
            <NumericInput
              value={form.yearBuilt === "" ? 0 : Number(form.yearBuilt)}
              onChange={(v) => field("yearBuilt", v ? String(Math.round(v)) : "")}
              maxFractionDigits={0}
            />
          </Field>
          <Field label="Square feet">
            <NumericInput
              value={form.sqft === "" ? 0 : Number(form.sqft)}
              onChange={(v) => field("sqft", v ? String(Math.round(v)) : "")}
              group
              maxFractionDigits={0}
              min={0}
            />
          </Field>
          <Field label="Lot square feet">
            <NumericInput
              value={form.lotSqft === "" ? 0 : Number(form.lotSqft)}
              onChange={(v) => field("lotSqft", v ? String(Math.round(v)) : "")}
              group
              maxFractionDigits={0}
              min={0}
            />
          </Field>
        </Section>

        <Section title="Money">
          <Field label="Purchase date">
            <TextInput
              type="date"
              value={form.purchaseDate}
              onChange={(e) => field("purchaseDate", e.target.value)}
            />
          </Field>
          <Field label="Purchase price ($)">
            <MoneyInput
              valueCents={form.purchasePrice === "" ? 0 : Math.round(Number(form.purchasePrice) * 100)}
              onChange={(c) => field("purchasePrice", c ? String(c / 100) : "")}
            />
          </Field>
          <Field label="Mortgage lender">
            <TextInput
              value={form.mortgageLender}
              onChange={(e) => field("mortgageLender", e.target.value)}
            />
          </Field>
          <Field label="Mortgage payment ($/mo)">
            <MoneyInput
              valueCents={form.mortgagePayment === "" ? 0 : Math.round(Number(form.mortgagePayment) * 100)}
              onChange={(c) => field("mortgagePayment", c ? String(c / 100) : "")}
            />
          </Field>
          <Field label="Insurance carrier">
            <TextInput
              value={form.insuranceCarrier}
              onChange={(e) => field("insuranceCarrier", e.target.value)}
            />
          </Field>
          <Field label="Policy number">
            <TextInput
              value={form.insurancePolicyNumber}
              onChange={(e) => field("insurancePolicyNumber", e.target.value)}
            />
          </Field>
        </Section>

        <Field label="Notes" hint="Anything that does not fit a field above.">
          <textarea
            className="kr-input"
            rows={3}
            value={form.notes}
            onChange={(e) => field("notes", e.target.value)}
            style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
          />
        </Field>

        <fieldset style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
          <legend className="kr-field-label" style={{ padding: 0 }}>
            Key colour
          </legend>
          <p className="kr-field-hint" style={{ marginTop: 0, marginBottom: 10 }}>
            Follows this property everywhere — the rail, its cards, this page.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {HERO_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => field("heroColor", c.value)}
                aria-pressed={form.heroColor === c.value}
                title={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${form.heroColor === c.value ? "var(--ink-2)" : "var(--line)"}`,
                  background: form.heroColor === c.value ? "var(--panel-2)" : "var(--panel)",
                  color: "var(--ink)",
                  fontSize: 12.5,
                }}
              >
                <KeyGlyph color={c.value} size="card" />
                {c.name}
              </button>
            ))}
          </div>
        </fieldset>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <Button type="submit" disabled={!ready || save.isPending}>
            {save.isPending ? "Saving…" : "Save details"}
          </Button>
          <Button type="button" variant="secondary" onClick={props.onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Section(props: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: 18 }}>
      <h3 className="kr-label" style={{ margin: "0 0 8px" }}>
        {props.title}
      </h3>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))",
        }}
      >
        {props.children}
      </div>
    </section>
  );
}
