import { it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ cookie: vi.fn(), returning: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("LOGIN_REDIRECT");
  },
}));
vi.mock("@/platform/db/client", () => ({
  getDatabase: () => ({
    update: () => ({
      set: () => ({ where: () => ({ returning: mocks.returning }) }),
    }),
  }),
}));
import { requireAdminSession } from "@/modules/admin/session";
beforeEach(() => vi.clearAllMocks());
it("rejects missing and malformed sessions before database access", async () => {
  mocks.cookie.mockReturnValue(undefined);
  await expect(requireAdminSession()).rejects.toThrow("LOGIN_REDIRECT");
  expect(mocks.returning).not.toHaveBeenCalled();
});
it("rejects unknown, expired or revoked sessions", async () => {
  mocks.cookie.mockReturnValue({ value: "a".repeat(64) });
  mocks.returning.mockResolvedValue([]);
  await expect(requireAdminSession()).rejects.toThrow("LOGIN_REDIRECT");
});
it("allows a valid server-resolved session", async () => {
  mocks.cookie.mockReturnValue({ value: "a".repeat(64) });
  mocks.returning.mockResolvedValue([{ id: "session", adminUserId: "admin" }]);
  expect(await requireAdminSession()).toEqual({
    id: "session",
    adminUserId: "admin",
  });
});
