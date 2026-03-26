import { NextFunction, Request, Response } from "express";
import StellarSdk from "@stellar/stellar-sdk";
import { Config, pickFeePayerAccount } from "../config";
import { AppError } from "../errors/AppError";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { syncTenantFromApiKey } from "../models/tenantStore";
import { recordSponsoredTransaction } from "../models/transactionLedger";
import { FeeBumpRequest, FeeBumpSchema } from "../schemas/feeBump";
import { checkTenantDailyQuota } from "../services/quota";
import { transactionStore } from "../workers/transactionStore";
import { calculateFeeBumpFee } from "../utils/feeCalculator";
import { signTransaction, signTransactionWithVault } from "../signing";

interface FeeBumpResponse {
  xdr: string;
  status: string;
  hash?: string;
  fee_payer: string;
}

export async function feeBumpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  config: Config,
): Promise<void> {
  try {
    const result = FeeBumpSchema.safeParse(req.body);
    if (!result.success) {
      return next(
        new AppError(
          `Validation failed: ${JSON.stringify(result.error.format())}`,
          400,
          "INVALID_XDR",
        ),
      );
    }

    const body: FeeBumpRequest = result.data;
    const feePayerAccount = pickFeePayerAccount(config);

    let innerTransaction: any;
    try {
      innerTransaction = StellarSdk.TransactionBuilder.fromXDR(
        body.xdr,
        config.networkPassphrase,
      );
    } catch (error: any) {
      return next(
        new AppError(`Invalid XDR: ${error.message}`, 400, "INVALID_XDR"),
      );
    }

    // Fixed: Declared once here and reused throughout the function
    const operationCount = innerTransaction.operations?.length || 0;

    if (operationCount > config.maxOperations) {
      return next(
        new AppError(
          `Transaction contains ${operationCount} operations, which exceeds the maximum allowed ${config.maxOperations}`,
          400,
          "TOO_MANY_OPERATIONS",
        ),
      );
    }

    if (
      !innerTransaction.signatures ||
      innerTransaction.signatures.length === 0
    ) {
      return next(
        new AppError(
          "Inner transaction must be signed before fee-bumping",
          400,
          "UNSIGNED_TRANSACTION",
        ),
      );
    }

    // Check if already fee-bumped
    const innerTransactionAny = innerTransaction as any;
    const isAlreadyFeeBumped =
      innerTransaction instanceof StellarSdk.FeeBumpTransaction ||
      innerTransactionAny?.type === "fee-bump" ||
      innerTransactionAny?.feeBumpTransaction != null ||
      (typeof innerTransactionAny === "object" &&
        "feeBumpTransaction" in innerTransactionAny);

    if (isAlreadyFeeBumped) {
      return next(
        new AppError(
          "Cannot fee-bump an already fee-bumped transaction",
          400,
          "ALREADY_FEE_BUMPED",
        ),
      );
    }

    // Tenant context check
    const apiKeyConfig = res.locals.apiKey as ApiKeyConfig | undefined;
    if (!apiKeyConfig) {
      res
        .status(500)
        .json({ error: "Missing tenant context for fee sponsorship" });
      return;
    }

    // Use existing operationCount for calculation
    const feeAmount = calculateFeeBumpFee(
      operationCount,
      config.baseFee,
      config.feeMultiplier,
    );

    const tenant = syncTenantFromApiKey(apiKeyConfig);
    const quotaCheck = checkTenantDailyQuota(tenant, feeAmount);
    if (!quotaCheck.allowed) {
      res.status(403).json({
        error: "Daily fee sponsorship quota exceeded",
        currentSpendStroops: quotaCheck.currentSpendStroops,
        attemptedFeeStroops: feeAmount,
        dailyQuotaStroops: quotaCheck.dailyQuotaStroops,
      });
      return;
    }

    // Build and sign the fee-bump
    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feePayerAccount.keypair,
      feeAmount,
      innerTransaction,
      config.networkPassphrase,
    );

    if (feePayerAccount.secretSource.type === "env") {
      await signTransaction(feeBumpTx, feePayerAccount.secretSource.secret);
    } else {
      if (!config.vault) throw new Error("Vault config missing");
      await signTransactionWithVault(
        feeBumpTx,
        feePayerAccount.publicKey,
        config.vault,
        feePayerAccount.secretSource.secretPath,
      );
    }

    recordSponsoredTransaction(tenant.id, feeAmount);
    const feeBumpXdr = feeBumpTx.toXDR();
    const submit = body.submit || false;

    if (submit && config.horizonUrl) {
      const server = new StellarSdk.Horizon.Server(config.horizonUrl);
      try {
        const submissionResult: any = await server.submitTransaction(feeBumpTx);
        transactionStore.addTransaction(
          submissionResult.hash,
          tenant.id,
          "submitted",
        );

        res.json({
          xdr: feeBumpXdr,
          status: "submitted",
          hash: submissionResult.hash,
          fee_payer: feePayerAccount.publicKey,
        });
      } catch (error: any) {
        return next(
          new AppError(
            `Submission failed: ${error.message}`,
            500,
            "SUBMISSION_FAILED",
          ),
        );
      }
      return;
    }

    res.json({
      xdr: feeBumpXdr,
      status: submit ? "submitted" : "ready",
      fee_payer: feePayerAccount.publicKey,
    });
  } catch (error: any) {
    next(error);
  }
}
