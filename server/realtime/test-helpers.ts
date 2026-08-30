// server/realtime/test-helpers.ts — WebSocket test client utilities. Test-only, not imported
// by any production code.

import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/realtime.js";

/** Starts the app listening on an ephemeral port and returns the ws:// base URL for /ws. */
export async function startWsServer(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${addr.port}/ws`;
}

export function openSocket(url: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const onOpen = (): void => {
      cleanup();
      resolve(ws);
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };
    const onUnexpected = (_req: unknown, res: { statusCode?: number }): void => {
      cleanup();
      reject(Object.assign(new Error("unexpected-response"), { statusCode: res.statusCode }));
    };
    function cleanup(): void {
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
      ws.removeListener("unexpected-response", onUnexpected);
    }
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("unexpected-response", onUnexpected);
  });
}

export interface WsTestClient {
  ws: WebSocket;
  send: (msg: ClientMessage) => void;
  /** Resolves with the next message matching `pred` (checking the backlog first). */
  waitFor: (pred: (m: ServerMessage) => boolean, timeoutMs?: number) => Promise<ServerMessage>;
  /** All messages received so far, in order. */
  received: ServerMessage[];
  close: () => void;
}

export function wrapClient(ws: WebSocket): WsTestClient {
  const backlog: ServerMessage[] = [];
  const received: ServerMessage[] = [];
  const waiters: {
    pred: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  ws.on("message", (data: Buffer | string) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      return;
    }
    received.push(msg);
    const idx = waiters.findIndex((w) => w.pred(msg));
    if (idx >= 0) {
      const w = waiters[idx]!;
      waiters.splice(idx, 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      backlog.push(msg);
    }
  });

  function waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const idx = backlog.findIndex(pred);
    if (idx >= 0) {
      const m = backlog[idx]!;
      backlog.splice(idx, 1);
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.findIndex((w) => w.resolve === resolve);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`timeout waiting for message matching predicate (got ${received.length} frames)`));
      }, timeoutMs);
      waiters.push({ pred, resolve, timer });
    });
  }

  return {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
    received,
    close: () => ws.close(),
  };
}
