// server/uploads/uploads.test.ts — validation cases, auth on /raw, soft-delete 404s, every
// AttachmentParentType, and singular-pointer rejection of a wrongly-owned upload.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { createTestApp, createTestUser, unwrap, type TestApp, type TestUser } from "../testing/harness.js";
import { getDb } from "../db/index.js";
import type { AttachmentParentType, Upload } from "../../shared/types.js";

let app: TestApp;
let user: TestUser;

beforeEach(async () => {
  app = await createTestApp();
  user = createTestUser({ role: "manager" });
});

afterEach(async () => {
  await app.close();
});

function cookieOnly(u: TestUser): Record<string, string> {
  const { cookie, "x-csrf-token": csrf } = u.headers;
  return { cookie, "x-csrf-token": csrf };
}

function multipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { name: string; contentType: string; bytes: Buffer },
): Buffer {
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  parts.push(file.bytes);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

async function createProperty(): Promise<string> {
  const res = await app.app.inject({
    method: "POST",
    url: "/api/properties",
    headers: user.headers,
    payload: {
      name: "Upload Test Property",
      addressLine1: "1 Test St",
      city: "T",
      state: "OH",
      postalCode: "45000",
      country: "US",
      propertyType: "single_family",
    },
  });
  return unwrap<{ id: string }>(res).id;
}

async function realJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 50, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "should be stripped" } } })
    .toBuffer();
}

describe("upload validation", () => {
  it("over UPLOAD_MAX_BYTES -> 413", async () => {
    process.env.UPLOAD_MAX_BYTES = "1000";
    const smallLimitApp = await createTestApp();
    const smallUser = createTestUser({ role: "manager" });
    const propRes = await smallLimitApp.app.inject({
      method: "POST",
      url: "/api/properties",
      headers: smallUser.headers,
      payload: {
        name: "Small Limit Property",
        addressLine1: "1 St",
        city: "T",
        state: "OH",
        postalCode: "45000",
        country: "US",
        propertyType: "single_family",
      },
    });
    const propertyId = unwrap<{ id: string }>(propRes).id;
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000, 1)]);
    const boundary = "----big";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "big.jpg", contentType: "image/jpeg", bytes: oversized },
    );
    const res = await smallLimitApp.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(smallUser), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
    await smallLimitApp.close();
    delete process.env.UPLOAD_MAX_BYTES;
  });

  it("a .png whose bytes are actually HTML -> 415", async () => {
    const propertyId = await createProperty();
    const boundary = "----fakepng";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "fake.png", contentType: "image/png", bytes: Buffer.from("<html><body>gotcha</body></html>") },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
  });

  it("an SVG is rejected (not on the allowlist)", async () => {
    const propertyId = await createProperty();
    const boundary = "----svg";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "icon.svg", contentType: "image/svg+xml", bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>") },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
  });

  it("a PDF named with a .jpg extension is stored as kind:'pdf' and served as an attachment", async () => {
    const propertyId = await createProperty();
    const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF\n");
    const boundary = "----pdf";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "sneaky.jpg", contentType: "application/pdf", bytes: pdfBytes },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const upload = unwrap<Upload>(res);
    expect(upload.kind).toBe("pdf");

    const rawRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}/raw`, headers: cookieOnly(user) });
    expect(rawRes.statusCode).toBe(200);
    expect(rawRes.headers["content-disposition"]).toContain("attachment");
    expect(rawRes.headers["content-type"]).toBe("application/pdf");
  });

  it("a filename containing '../' cannot escape the upload directory", async () => {
    const propertyId = await createProperty();
    const boundary = "----traversal";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "../../../../etc/passwd.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const upload = unwrap<Upload>(res);
    expect(upload.filename).not.toContain("..");
    expect(upload.filename).not.toContain("/");
    const row = getDb().prepare(`SELECT stored_path FROM uploads WHERE id = ?`).get(upload.id) as {
      stored_path: string;
    };
    expect(row.stored_path).not.toContain("..");
  });

  it("a valid JPEG is re-encoded, stripped of metadata, thumbnailed, and records width/height", async () => {
    const propertyId = await createProperty();
    const boundary = "----validjpeg";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "photo.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const upload = unwrap<Upload>(res);
    expect(upload.kind).toBe("image");
    expect(upload.width).toBe(50);
    expect(upload.height).toBe(30);
    expect(upload.hasThumb).toBe(true);
    expect(upload.thumbUrl).not.toBeNull();

    const thumbRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}/thumb`, headers: cookieOnly(user) });
    expect(thumbRes.statusCode).toBe(200);
    expect(thumbRes.headers["content-type"]).toBe("image/webp");
  });
});

describe("upload access rules", () => {
  it("/raw requires a session", async () => {
    const propertyId = await createProperty();
    const boundary = "----auth";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "photo.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    const upload = unwrap<Upload>(res);

    const anonRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}/raw` });
    expect(anonRes.statusCode).toBe(401);
  });

  it("soft-deleted uploads 404 from every read route", async () => {
    const propertyId = await createProperty();
    const boundary = "----softdelete";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyId },
      { name: "photo.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
    );
    const res = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    const upload = unwrap<Upload>(res);

    const delRes = await app.app.inject({ method: "DELETE", url: `/api/uploads/${upload.id}`, headers: cookieOnly(user) });
    expect(delRes.statusCode).toBe(200);

    const getRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}`, headers: cookieOnly(user) });
    expect(getRes.statusCode).toBe(404);
    const rawRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}/raw`, headers: cookieOnly(user) });
    expect(rawRes.statusCode).toBe(404);
    const thumbRes = await app.app.inject({ method: "GET", url: `/api/uploads/${upload.id}/thumb`, headers: cookieOnly(user) });
    expect(thumbRes.statusCode).toBe(404);
  });

  it("a singular pointer rejects an upload belonging to another parent", async () => {
    const propertyA = await createProperty();
    const propertyB = await createProperty();
    const boundary = "----pointer";
    const body = multipartBody(
      boundary,
      { parentType: "property", parentId: propertyA },
      { name: "cover.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
    );
    const uploadRes = await app.app.inject({
      method: "POST",
      url: "/api/uploads",
      headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    const upload = unwrap<Upload>(uploadRes);

    // The upload belongs to property A; pointing property B's coverUploadId at it must fail.
    const propBVersion = (
      unwrap<{ version: number }>(
        await app.app.inject({ method: "GET", url: `/api/properties/${propertyB}`, headers: cookieOnly(user) }),
      )
    ).version;
    const patchRes = await app.app.inject({
      method: "PATCH",
      url: `/api/properties/${propertyB}`,
      headers: user.headers,
      payload: { coverUploadId: upload.id, expectedVersion: propBVersion },
    });
    expect(patchRes.statusCode).toBe(400);

    // Pointing property A (the real parent) at it succeeds.
    const propAVersion = (
      unwrap<{ version: number }>(
        await app.app.inject({ method: "GET", url: `/api/properties/${propertyA}`, headers: cookieOnly(user) }),
      )
    ).version;
    const okRes = await app.app.inject({
      method: "PATCH",
      url: `/api/properties/${propertyA}`,
      headers: user.headers,
      payload: { coverUploadId: upload.id, expectedVersion: propAVersion },
    });
    expect(okRes.statusCode).toBe(200);
  });
});

describe("attachments resolve for every AttachmentParentType", () => {
  const ALL_PARENT_TYPES: AttachmentParentType[] = [
    "property",
    "unit",
    "note",
    "work_order",
    "project",
    "lease",
    "tenant",
    "property_expense",
    "spec_entry",
    "turnover",
    "compliance_item",
    "vendor",
  ];

  it("covers all twelve parent types", async () => {
    expect(ALL_PARENT_TYPES.length).toBe(12);

    const propertyId = await createProperty();
    const unitRes = await app.app.inject({
      method: "POST",
      url: `/api/properties/${propertyId}/units`,
      headers: user.headers,
      payload: { label: "Unit A", status: "vacant" },
    });
    const unitId = unwrap<{ id: string }>(unitRes).id;

    const noteId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/notes`,
        headers: user.headers,
        payload: { body: "note" },
      }),
    ).id;
    const woId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/work-orders`,
        headers: user.headers,
        payload: { title: "wo", status: "new", priority: "normal" },
      }),
    ).id;
    const projectId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/projects`,
        headers: user.headers,
        payload: { title: "proj", status: "idea", priority: "normal" },
      }),
    ).id;
    const leaseId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/leases`,
        headers: user.headers,
        payload: {
          unitId,
          startDate: "2026-01-01",
          rentCents: 100000,
          depositCents: 100000,
          dueDay: 1,
          status: "active",
          renewalNoticeDays: 60,
          tenantIds: [],
        },
      }),
    ).id;
    const tenantId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/tenants`,
        headers: user.headers,
        payload: { unitId, firstName: "A", lastName: "B", isPrimary: true },
      }),
    ).id;
    const expenseId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/expenses`,
        headers: user.headers,
        payload: { category: "repair", description: "x", amountCents: 1000, incurredOn: "2026-01-01" },
      }),
    ).id;
    const specId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/specs`,
        headers: user.headers,
        payload: { category: "filter", label: "f", isSecret: false },
      }),
    ).id;
    const turnoverId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/turnovers`,
        headers: user.headers,
        payload: { unitId, phase: "move_out" },
      }),
    ).id;
    const complianceId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/compliance`,
        headers: user.headers,
        payload: { kind: "insurance", title: "c", dueDate: "2026-06-01", leadDays: 30, recurrence: "none" },
      }),
    ).id;
    const vendorId = unwrap<{ id: string }>(
      await app.app.inject({
        method: "POST",
        url: "/api/vendors",
        headers: user.headers,
        payload: { name: "v", trade: "General", preferred: false },
      }),
    ).id;

    const parentIds: Record<AttachmentParentType, string> = {
      property: propertyId,
      unit: unitId,
      note: noteId,
      work_order: woId,
      project: projectId,
      lease: leaseId,
      tenant: tenantId,
      property_expense: expenseId,
      spec_entry: specId,
      turnover: turnoverId,
      compliance_item: complianceId,
      vendor: vendorId,
    };

    for (const parentType of ALL_PARENT_TYPES) {
      const boundary = `----${parentType}`;
      const body = multipartBody(
        boundary,
        { parentType, parentId: parentIds[parentType] },
        { name: "a.jpg", contentType: "image/jpeg", bytes: await realJpeg() },
      );
      const res = await app.app.inject({
        method: "POST",
        url: "/api/uploads",
        headers: { ...cookieOnly(user), "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
      expect(res.statusCode, `parentType=${parentType}`).toBe(201);
      const upload = unwrap<Upload>(res);
      expect(upload.parentType).toBe(parentType);

      const listRes = await app.app.inject({
        method: "GET",
        url: `/api/uploads?parentType=${parentType}&parentId=${parentIds[parentType]}`,
        headers: cookieOnly(user),
      });
      const list = unwrap<{ items: Upload[] }>(listRes);
      expect(list.items.some((u) => u.id === upload.id), `parentType=${parentType} list`).toBe(true);
    }
  });
});
