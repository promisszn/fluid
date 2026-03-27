import { z } from "zod";

export const UpdateWebhookSchema = z
  .object({
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecret: z
      .string()
      .trim()
      .min(1, "Webhook secret cannot be empty")
      .nullable()
      .optional(),
  })
  .refine(
    ({ webhookSecret, webhookUrl }) =>
      webhookSecret !== undefined || webhookUrl !== undefined,
    {
      message: "At least one webhook field must be provided",
    },
  );

export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookSchema>;
