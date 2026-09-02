// server/domain/discussion/discussion.test.ts — the property thread.
//
// The ask: "a main discussion chat area for property discussion on likes and
// dislikes on the property."
//
// Two properties matter and neither is obvious from reading the SQL. A thread
// has to read in the order it was said — notes are newest-first and copying
// that here would scramble a conversation — and it has to be attributable, so
// nobody can edit words into somebody else's mouth.
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, createTestUser, unwrap, type TestApp } from "../../testing/harness.js";
import type { PropertyCommentView, PropertyDossier, PropertyView } from "../../../shared/types.js";

/**
 * DELETE carries no body, but the harness bakes a JSON content-type into every
 * request's headers, so Fastify tries to parse "" and answers 400 before the
 * route is reached. Stripping it is the difference between testing the
 * permission check and testing the body parser.
 */
function bodyless(h: Record<string, string>): Record<string, string> {
  const rest = { ...h };
  delete rest["content-type"];
  return rest;
}

async function makeProperty(testApp: TestApp, headers: Record<string, string>): Promise<string> {
  const res = await testApp.app.inject({
    method: "POST",
    url: "/api/properties",
    headers,
    payload: {
      name: "The one on the sound",
      addressLine1: "1 Test St",
      city: "Nags Head",
      state: "NC",
      postalCode: "27959",
      propertyType: "single_family",
      stage: "prospect",
    },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyView>(res).id;
}

async function say(
  testApp: TestApp,
  headers: Record<string, string>,
  propertyId: string,
  body: string,
  sentiment?: "like" | "dislike",
): Promise<PropertyCommentView> {
  const res = await testApp.app.inject({
    method: "POST",
    url: `/api/properties/${propertyId}/discussion`,
    headers,
    payload: sentiment ? { body, sentiment } : { body },
  });
  expect(res.statusCode).toBe(201);
  return unwrap<PropertyCommentView>(res);
}

describe("property discussion", () => {
  let testApp: TestApp | null = null;

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  it("reads oldest first, the order it was said", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    for (const line of ["First thing", "Second thing", "Third thing"]) {
      await say(testApp, user.headers, propertyId, line);
    }

    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/discussion`,
      headers: user.headers,
    });
    const items = unwrap<{ items: PropertyCommentView[] }>(res).items;
    expect(items.map((c) => c.body)).toEqual(["First thing", "Second thing", "Third thing"]);
  });

  it("carries likes and dislikes, and leaves plain messages unlabelled", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    const like = await say(testApp, user.headers, propertyId, "Sound views from the deck", "like");
    const dislike = await say(testApp, user.headers, propertyId, "Ground floor is enclosed", "dislike");
    const plain = await say(testApp, user.headers, propertyId, "Showing is Thursday");

    expect(like.sentiment).toBe("like");
    expect(dislike.sentiment).toBe("dislike");
    // Not "neutral": most messages are neither, and a third enum value nobody
    // picks would still have to be rendered somewhere.
    expect(plain.sentiment).toBeNull();
  });

  it("attributes every message, and only marks the ones actually edited", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    const posted = await say(testApp, user.headers, propertyId, "Roof looks near the end");
    expect(posted.author?.id).toBe(user.id);
    expect(posted.edited).toBe(false);

    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/property-comments/${posted.id}`,
      headers: user.headers,
      payload: { body: "Roof looks 20+ years old", expectedVersion: posted.version },
    });
    expect(res.statusCode).toBe(200);
    expect(unwrap<PropertyCommentView>(res).edited).toBe(true);
  });

  it("refuses to let anyone edit someone else's message", async () => {
    testApp = await createTestApp();
    const author = createTestUser({ role: "manager" });
    const owner = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, author.headers);
    const posted = await say(testApp, author.headers, propertyId, "I think the price is high");

    // Not even the owner. Putting words in someone's mouth in a thread that
    // records who said what is not a permission worth having.
    const res = await testApp.app.inject({
      method: "PATCH",
      url: `/api/property-comments/${posted.id}`,
      headers: owner.headers,
      payload: { body: "I think the price is fine", expectedVersion: posted.version },
    });
    expect(res.statusCode).toBe(403);

    const after = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/discussion`,
      headers: owner.headers,
    });
    expect(unwrap<{ items: PropertyCommentView[] }>(after).items[0]!.body).toBe(
      "I think the price is high",
    );
  });

  it("lets an owner delete anyone's message, but a manager only their own", async () => {
    testApp = await createTestApp();
    const author = createTestUser({ role: "manager" });
    const other = createTestUser({ role: "manager" });
    const owner = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, author.headers);

    const a = await say(testApp, author.headers, propertyId, "One");
    const b = await say(testApp, author.headers, propertyId, "Two");

    const byOther = await testApp.app.inject({
      method: "DELETE",
      url: `/api/property-comments/${a.id}`,
      headers: bodyless(other.headers),
    });
    expect(byOther.statusCode).toBe(403);

    const byOwner = await testApp.app.inject({
      method: "DELETE",
      url: `/api/property-comments/${a.id}`,
      headers: bodyless(owner.headers),
    });
    expect(byOwner.statusCode).toBe(200);

    const byAuthor = await testApp.app.inject({
      method: "DELETE",
      url: `/api/property-comments/${b.id}`,
      headers: bodyless(author.headers),
    });
    expect(byAuthor.statusCode).toBe(200);
  });

  it("rejects an empty message rather than storing a blank line", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);

    for (const body of ["", "   "]) {
      const res = await testApp.app.inject({
        method: "POST",
        url: `/api/properties/${propertyId}/discussion`,
        headers: user.headers,
        payload: { body },
      });
      expect(res.statusCode).toBe(422);
    }
  });

  it("ships with the dossier, so the tab needs no second request", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    await say(testApp, user.headers, propertyId, "Worth a second look", "like");

    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/dossier`,
      headers: user.headers,
    });
    const dossier = unwrap<PropertyDossier>(res);
    expect(dossier.discussion).toHaveLength(1);
    expect(dossier.discussion[0]!.sentiment).toBe("like");
  });

  it("goes with the property when the property goes", async () => {
    testApp = await createTestApp();
    const user = createTestUser({ role: "owner" });
    const propertyId = await makeProperty(testApp, user.headers);
    await say(testApp, user.headers, propertyId, "Passing on this one");

    const del = await testApp.app.inject({
      method: "DELETE",
      url: `/api/properties/${propertyId}`,
      headers: bodyless(user.headers),
    });
    expect(del.statusCode).toBe(200);

    // ON DELETE CASCADE. Orphaned comments would be unreachable rows holding
    // a foreign key to a row that no longer exists.
    const res = await testApp.app.inject({
      method: "GET",
      url: `/api/properties/${propertyId}/discussion`,
      headers: user.headers,
    });
    expect(res.statusCode).toBe(404);
  });
});
