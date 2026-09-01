// server/domain/properties/edit.test.ts — editing a property after it exists.
//
// "Cut a new key" deliberately asks for the minimum, which left the rest of the
// schema — mortgage, insurance, parcel number, year built, cover photo —
// enterable nowhere. These assert the PATCH actually persists each of them, and
// that clearing a field genuinely clears it rather than storing "".
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import type { PropertyView } from "../../../shared/types.js";

async function makeProperty(testApp: TestApp, headers: Record<string, string>): Promise<PropertyView> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name: "Minimal",
      addressLine1: "1 Short St",
      city: "Springfield",
      state: "OH",
      postalCode: "45501",
      propertyType: "single_family",
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res);
}

describe("editing property details", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("saves every field the create form does not ask for", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProperty(testApp, user.headers);

    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${p.id}`,
      headers: user.headers,
      payload: {
        name: "Renamed",
        addressLine2: "Rear unit",
        propertyType: "duplex",
        yearBuilt: 1965,
        sqft: 1548,
        lotSqft: 7405,
        parcelNumber: "12-345-678",
        purchaseDate: "2023-04-01",
        purchasePriceCents: 249_900_00,
        mortgageLender: "First Regional",
        mortgagePaymentCents: 1_438_92,
        insuranceCarrier: "Statewide",
        insurancePolicyNumber: "POL-9",
        notes: "Roof replaced 2021.",
        expectedVersion: p.version,
      },
    });
    expect(res.statusCode).toBe(200);
    const saved = unwrap<PropertyView>(res);

    expect(saved.name).toBe("Renamed");
    expect(saved.addressLine2).toBe("Rear unit");
    expect(saved.propertyType).toBe("duplex");
    expect(saved.yearBuilt).toBe(1965);
    expect(saved.sqft).toBe(1548);
    expect(saved.lotSqft).toBe(7405);
    expect(saved.parcelNumber).toBe("12-345-678");
    expect(saved.purchaseDate).toBe("2023-04-01");
    expect(saved.purchasePriceCents).toBe(249_900_00);
    expect(saved.mortgageLender).toBe("First Regional");
    expect(saved.mortgagePaymentCents).toBe(1_438_92);
    expect(saved.insuranceCarrier).toBe("Statewide");
    expect(saved.insurancePolicyNumber).toBe("POL-9");
    expect(saved.notes).toBe("Roof replaced 2021.");
    expect(saved.version).toBe(p.version + 1);
  });

  it("clears a field back to null rather than storing an empty string", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProperty(testApp, user.headers);

    const withValue = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "PATCH",
        url: `/api/properties/${p.id}`,
        headers: user.headers,
        payload: { mortgageLender: "First Regional", expectedVersion: p.version },
      }),
    );
    expect(withValue.mortgageLender).toBe("First Regional");

    const cleared = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "PATCH",
        url: `/api/properties/${p.id}`,
        headers: user.headers,
        payload: { mortgageLender: null, expectedVersion: withValue.version },
      }),
    );
    // The dossier tests for absence to decide whether to show a row, so ""
    // would render an empty line where nothing should appear at all.
    expect(cleared.mortgageLender).toBeNull();
  });

  it("sets and clears the cover photo", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProperty(testApp, user.headers);

    // A 1x1 PNG is enough — this is about the wiring, not the pixels.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const boundary = "----keyringtest";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="parentType"\r\n\r\nproperty\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="parentId"\r\n\r\n${p.id}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="front.png"\r\n` +
          `Content-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await testApp.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: {
        ...user.headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(201);
    const upload = unwrap<{ id: string }>(uploadRes);

    const withCover = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "PATCH",
        url: `/api/properties/${p.id}`,
        headers: user.headers,
        payload: { coverUploadId: upload.id, expectedVersion: p.version },
      }),
    );
    expect(withCover.coverUploadId).toBe(upload.id);
    // coverUrl is what the dashboard renders; the id alone would not prove the
    // card actually gets a picture.
    expect(withCover.coverUrl).toBeTruthy();

    const cleared = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "PATCH",
        url: `/api/properties/${p.id}`,
        headers: user.headers,
        payload: { coverUploadId: null, expectedVersion: withCover.version },
      }),
    );
    expect(cleared.coverUploadId).toBeNull();
    expect(cleared.coverUrl).toBeNull();
  });

  it("refuses a stale edit rather than overwriting someone else's", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "manager" });
    const p = await makeProperty(testApp, user.headers);

    await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${p.id}`,
      headers: user.headers,
      payload: { name: "Theirs", expectedVersion: p.version },
    });

    const stale = await testApp.app.inject({
      method: "PATCH",
      url: `/api/properties/${p.id}`,
      headers: user.headers,
      payload: { name: "Mine", expectedVersion: p.version },
    });
    expect(stale.statusCode).toBe(409);

    const now = unwrap<PropertyView>(
      await testApp.app.inject({
        method: "GET",
        url: `/api/properties/${p.id}`,
        headers: user.headers,
      }),
    );
    expect(now.name).toBe("Theirs");
  });
});
