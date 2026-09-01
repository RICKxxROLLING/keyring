import { useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Upload, WorkOrderView } from "../../shared/types";
import type { ParsedReceipt } from "../../shared/receipt-parse";
import { apiPost, apiUpload } from "../lib/api";
import { Button } from "./Button";
import { Field, Select } from "./Form";
import { CameraIcon } from "./icons";

interface OcrResponse {
  available: boolean;
  fields: ParsedReceipt;
  text: string | null;
}

export interface ScannedReceipt {
  upload: Upload;
  fields: ParsedReceipt;
  /** Which work order to bill it to, if any. */
  workOrderId: string | null;
}

/**
 * Photograph a receipt; get a draft expense back.
 *
 * Two steps that look like one: the photo is uploaded (which files it against
 * the property and gives it an id), then scanned. They are separate requests
 * because the upload has to succeed on its own — if scanning is unavailable or
 * the reading is useless, you still have the receipt filed and you type the
 * figures, which is exactly what you did before this existed.
 *
 * Nothing here saves an expense. It hands a draft up to the form, where a
 * person confirms it. OCR is wrong often enough that the reading has to be
 * treated as a suggestion, and every field it fills is shown alongside the
 * photo so it can be checked against the paper.
 */
export function ReceiptScanner(props: {
  propertyId: string;
  /** Open work orders, so a receipt can be billed to the job it belongs to. */
  workOrders: WorkOrderView[];
  onScanned: (result: ScannedReceipt) => void;
}): ReactElement {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [fields, setFields] = useState<ParsedReceipt | null>(null);
  const [workOrderId, setWorkOrderId] = useState<string>("");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("parentType", "property");
      form.append("parentId", props.propertyId);
      const uploaded = await apiUpload("/api/uploads", form);

      // The upload stands on its own. A failed scan leaves the receipt filed.
      const ocr = await apiPost<OcrResponse>(`/api/uploads/${uploaded.id}/ocr`);
      return { uploaded, ocr };
    },
    onSuccess: ({ uploaded, ocr }) => {
      setUpload(uploaded);
      setFields(ocr.fields);
      setUnavailable(!ocr.available);
    },
    onError: () => setError("Couldn't upload that photo."),
  });

  function useIt(): void {
    if (!upload) return;
    props.onScanned({ upload, fields: fields ?? {}, workOrderId: workOrderId || null });
    setUpload(null);
    setFields(null);
    setWorkOrderId("");
  }

  const read = fields ? Object.keys(fields).length : 0;

  return (
    <div
      style={{
        border: "1px dashed var(--line)",
        borderRadius: 13,
        padding: 14,
        background: "var(--panel-2)",
      }}
    >
      {!upload && (
        <>
          <label
            className="tap-target"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--panel)",
              color: "var(--ink)",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <CameraIcon width={16} height={16} />
            {scan.isPending ? "Reading…" : "Scan a receipt"}
            <input
              type="file"
              accept="image/*"
              // Opens the camera directly on a phone, which is where a receipt
              // is usually photographed — standing in the shop, not at a desk.
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setError(null);
                  scan.mutate(file);
                }
                e.target.value = "";
              }}
            />
          </label>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
            Photograph the receipt and the amount, date and vendor are filled in for you to check.
            The photo is filed against this property either way.
          </p>
        </>
      )}

      {error && (
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--crit)" }}>{error}</p>
      )}

      {upload && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {/* The photo stays on screen beside the numbers, so the reading can
              be checked against the paper rather than taken on trust. */}
          <img
            src={upload.thumbUrl ?? upload.url}
            alt="The receipt you just photographed"
            style={{
              width: 130,
              height: 170,
              objectFit: "cover",
              borderRadius: 10,
              border: "1px solid var(--line)",
              flex: "none",
            }}
          />

          <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 10, alignContent: "start" }}>
            {unavailable ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
                <strong>Scanning isn&apos;t available on this server.</strong> The receipt is
                filed — type the amount and date below.
              </p>
            ) : read === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
                <strong>Couldn&apos;t read that one.</strong> The receipt is filed — type the
                figures below. A flatter, better-lit photo usually reads.
              </p>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
                  Read {read} field{read === 1 ? "" : "s"}. Check them against the photo.
                </p>
                <dl style={{ display: "grid", gap: 4, margin: 0 }}>
                  <ReadField label="Amount" value={money(fields?.totalCents)} />
                  <ReadField label="Date" value={fields?.incurredOn} />
                  <ReadField label="Vendor" value={fields?.vendorName} />
                  <ReadField label="Category" value={fields?.category} />
                </dl>
              </>
            )}

            {props.workOrders.length > 0 && (
              <Field label="Bill it to a work order" hint="Optional.">
                <Select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
                  <option value="">Not tied to a job</option>
                  {props.workOrders.map((w) => (
                    <option key={w.id} value={w.id}>
                      WO-{w.number} · {w.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={useIt}>Use this</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setUpload(null);
                  setFields(null);
                  setWorkOrderId("");
                }}
              >
                Discard
              </Button>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--ink-3)" }}>
              Discarding leaves the photo filed under Papers — it does not delete it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadField(props: { label: string; value: string | undefined }): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
      <dt className="kr-label" style={{ fontSize: 9 }}>
        {props.label}
      </dt>
      <dd
        className={props.value ? "kr-tabular" : undefined}
        style={{ margin: 0, color: props.value ? "var(--ink)" : "var(--ink-3)" }}
      >
        {/* An unread field says so rather than showing a blank, which would
            look like the receipt said zero. */}
        {props.value ?? "not read"}
      </dd>
    </div>
  );
}

function money(cents: number | undefined): string | undefined {
  return cents === undefined ? undefined : `$${(cents / 100).toFixed(2)}`;
}
