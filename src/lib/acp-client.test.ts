import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcpClient } from "./acp-client";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

describe("AcpClient.prompt", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("returns stop reason from successful prompt", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "acp_prompt") {
        return Promise.resolve({ stopReason: "end_turn" });
      }
      return Promise.resolve(null);
    });

    const client = new (AcpClient as unknown as { new(session: number, backend: string): AcpClient })(1, "codex");
    const result = await client.prompt([{ type: "text", text: "hello" }]);
    expect(result).toBe("end_turn");
  });

  it("marks client dead on subprocess exit stop event", async () => {
    let eventHandler: ((e: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((_channel: string, handler: (e: { payload: unknown }) => void) => {
      eventHandler = handler;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "acp_spawn") return Promise.resolve(1);
      return Promise.resolve(null);
    });

    const client = await AcpClient.spawn("codex", "/tmp", []);
    expect(client.dead).toBe(false);

    eventHandler!({ payload: { type: "stop", stopReason: "cancelled", reason: "subprocess exited" } });
    expect(client.dead).toBe(true);
  });

  it("does not mark client dead on normal cancel", async () => {
    let eventHandler: ((e: { payload: unknown }) => void) | null = null;
    listenMock.mockImplementation((_channel: string, handler: (e: { payload: unknown }) => void) => {
      eventHandler = handler;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === "acp_spawn") return Promise.resolve(1);
      return Promise.resolve(null);
    });

    const client = await AcpClient.spawn("codex", "/tmp", []);
    eventHandler!({ payload: { type: "stop", stopReason: "cancelled" } });
    expect(client.dead).toBe(false);
  });
});
