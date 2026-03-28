import { describe, it, expect } from "@jest/globals";
import StellarSdk from "@stellar/stellar-sdk";
import { verifySettlementPayment, extractSettlementRequirement } from "./settlementVerifier";
import { Config } from "../config";

describe("settlementVerifier", () => {
  const feePayerKeypair = StellarSdk.Keypair.random();
  const feePayerPublicKey = feePayerKeypair.publicKey();
  const sourcePublicKey = StellarSdk.Keypair.random().publicKey();
  const issuerPublicKey = StellarSdk.Keypair.random().publicKey();
  const wrongDestination = StellarSdk.Keypair.random().publicKey();
  const createAccountDestination = StellarSdk.Keypair.random().publicKey();
  const btcIssuerPublicKey = StellarSdk.Keypair.random().publicKey();
  const settlementToken = `USDC:${issuerPublicKey}`;

  const mockConfig: Config = {
    feePayerAccounts: [
      {
        publicKey: feePayerPublicKey,
        keypair: feePayerKeypair,
        secretSource: { type: "env", secret: "placeholder-test-secret" }
      }
    ],
    signerPool: {} as any,
    baseFee: 100,
    feeMultiplier: 2.0,
    networkPassphrase: "Test SDF Network ; September 2015",
    rateLimitWindowMs: 60000,
    rateLimitMax: 5,
    allowedOrigins: [],
    alerting: {
      checkIntervalMs: 3600000,
      cooldownMs: 21600000
    }
  };

  describe("verifySettlementPayment", () => {
    it("should accept a valid payment operation", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: feePayerPublicKey,
            asset: StellarSdk.Asset.native(),
            amount: "0.00002", // 200 stroops
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: "XLM",
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(true);
      expect(result.actualAmount).toBe("0.00002");
      expect(result.assetCode).toBe("XLM");
    });

    it("should accept a valid pathPaymentStrictReceive operation", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictReceive({
            sendAsset: StellarSdk.Asset.native(),
            sendMax: "1",
            destination: feePayerPublicKey,
            destAsset: new StellarSdk.Asset("USDC", issuerPublicKey),
            destAmount: "0.00002", // 200 stroops equivalent
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: settlementToken,
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(true);
      expect(result.actualAmount).toBe("0.00002");
      expect(result.assetCode).toBe(settlementToken);
    });

    it("should reject insufficient payment amount", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: feePayerPublicKey,
            asset: StellarSdk.Asset.native(),
            amount: "0.00001", // 100 stroops - insufficient
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: "XLM",
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe("Incorrect settlement amount");
      expect(result.expectedAmount).toBe("0.00002");
      expect(result.actualAmount).toBe("0.00001");
    });

    it("should reject payment to wrong destination", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: wrongDestination,
            asset: StellarSdk.Asset.native(),
            amount: "0.00002",
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: "XLM",
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("No settlement payment found");
    });

    it("should reject payment with wrong asset", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: feePayerPublicKey,
            asset: new StellarSdk.Asset("BTC", btcIssuerPublicKey),
            amount: "0.00002",
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: settlementToken,
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("No settlement payment found");
    });

    it("should reject when no settlement operations are found", () => {
      const sourceAccount = new StellarSdk.Account(sourcePublicKey, "1");
      const innerTransaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: "Test SDF Network ; September 2015",
      })
        .addOperation(
          StellarSdk.Operation.createAccount({
            destination: createAccountDestination,
            startingBalance: "1",
          })
        )
        .setTimeout(30)
        .build();

      const result = verifySettlementPayment(innerTransaction, {
        token: "XLM",
        requiredAmountStroops: 200,
      }, mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("No settlement payment found");
    });
  });

  describe("extractSettlementRequirement", () => {
    it("should return null when no token is specified", () => {
      const result = extractSettlementRequirement(undefined, 200);
      expect(result).toBeNull();
    });

    it("should return requirement when token is specified", () => {
      const result = extractSettlementRequirement(settlementToken, 200);
      expect(result).toEqual({
        token: settlementToken,
        requiredAmountStroops: 200,
      });
    });

    it("should use default fee amount when not specified", () => {
      const result = extractSettlementRequirement("XLM");
      expect(result).toEqual({
        token: "XLM",
        requiredAmountStroops: 100,
      });
    });
  });
});
