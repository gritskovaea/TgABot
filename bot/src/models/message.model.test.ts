import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
  pool: { query: vi.fn() },
}));

import { pool } from "../db/index.js";
import {
  chatTotals,
  messagesByUser,
  topUsers,
  userMessageCount,
  userRank,
} from "./message.model.js";

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe("message.model", () => {
  it("topUsers returns rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, username: "john", first_name: "John", last_name: "D", count: 2 }],
    });

    const res = await topUsers(123);
    expect(res.rows[0]?.username).toBe("john");
  });

  it("chatTotals returns messages/users", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ messages: 10, users: 3 }] });
    const totals = await chatTotals(123);
    expect(totals).toEqual({ messages: 10, users: 3 });
  });

  it("messagesByUser maps texts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ text: "a" }, { text: "b" }] });
    const texts = await messagesByUser(7, 2, 123);
    expect(texts).toEqual(["a", "b"]);
  });

  it("userMessageCount returns count", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });
    const count = await userMessageCount(123, 7);
    expect(count).toBe(5);
  });

  it("userRank returns rank and total", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 10, count: 5 },
        { user_id: 7, count: 3 },
      ],
    });
    const info = await userRank(123, 7);
    expect(info).toEqual({ rank: 2, totalUsers: 2 });
  });
});
