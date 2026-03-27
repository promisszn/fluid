import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateWebhookHandler } from "./tenantWebhook";
import { prisma } from "../utils/db";

vi.mock("../utils/db", () => ({
  prisma: {
    tenant: {
      update: vi.fn(),
    },
  },
}));

const mockPrisma = prisma as any;

describe("updateWebhookHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates webhook url and secret without returning the secret", async () => {
    mockPrisma.tenant.update.mockResolvedValue({
      id: "tenant-1",
      webhookSecret: "super-secret",
      webhookUrl: "https://example.com/webhooks/fluid",
    });

    const req: any = {
      body: {
        webhookSecret: "super-secret",
        webhookUrl: "https://example.com/webhooks/fluid",
      },
    };
    const res: any = {
      locals: {
        apiKey: {
          tenantId: "tenant-1",
        },
      },
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await updateWebhookHandler(req, res, next);

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: {
        webhookSecret: "super-secret",
        webhookUrl: "https://example.com/webhooks/fluid",
      },
      select: {
        id: true,
        webhookSecret: true,
        webhookUrl: true,
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: "tenant-1",
      webhookSecretConfigured: true,
      webhookUrl: "https://example.com/webhooks/fluid",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an empty patch body", async () => {
    const req: any = {
      body: {},
    };
    const res: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await updateWebhookHandler(req, res, next);

    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Object),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
