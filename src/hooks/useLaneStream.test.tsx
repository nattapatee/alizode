import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLaneStream } from "./useLaneStream";
import type { AcpEvent } from "../lib/acp-types";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

class MockClient {
  private listeners: Array<(event: AcpEvent) => void> = [];

  onEvent(cb: (event: AcpEvent) => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }

  emit(event: AcpEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

describe("useLaneStream", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears loading and marks the lane errored when the backend emits an error", async () => {
    const client = new MockClient();
    const onLaneStatus = vi.fn();

    const { result } = renderHook(() =>
      useLaneStream("lane-1", "ws-1", client as never, undefined, onLaneStatus),
    );

    act(() => {
      result.current.addUserInput("hello");
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      client.emit({ type: "error", message: "backend died" });
    });

    expect(result.current.isLoading).toBe(false);
    expect(onLaneStatus).toHaveBeenCalledWith("lane-1", "Error");
  });
});
