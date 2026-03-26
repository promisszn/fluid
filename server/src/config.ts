import StellarSdk from "@stellar/stellar-sdk";

export interface FeePayerAccount {
  publicKey: string;
  keypair: any;
  secretSource:
    | { type: "env"; secret: string }
    | { type: "vault"; secretPath: string };
}

export interface VaultConfig {
  addr: string;
  token?: string;
  appRole?: {
    roleId: string;
    secretId: string;
  };
  kvMount: string;
  kvVersion: 1 | 2;
  secretField: string;
}

export interface Config {
  feePayerAccounts: FeePayerAccount[];
  baseFee: number;
  feeMultiplier: number;
  networkPassphrase: string;
  horizonUrl?: string;
  maxXdrSize: number;
  maxOperations: number;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
  vault?: VaultConfig;
}

export function loadConfig(): Config {
  const allowedOriginsRaw = process.env.FLUID_ALLOWED_ORIGINS;
  const allowedOrigins = allowedOriginsRaw
    ?.split(",")
    .map((s: string) => s.trim())
    .filter(Boolean) ?? ["*"];

  const rateLimitWindowMs = parseInt(
    process.env.FLUID_RATE_LIMIT_WINDOW_MS || "60000",
    10,
  );
  const rateLimitMax = parseInt(process.env.FLUID_RATE_LIMIT_MAX || "5", 10);
  const baseFee = parseInt(process.env.FLUID_BASE_FEE || "100", 10);
  const feeMultiplier = parseFloat(process.env.FLUID_FEE_MULTIPLIER || "2.0");
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ||
    "Test SDF Network ; September 2015";
  const horizonUrl = process.env.STELLAR_HORIZON_URL;

  const maxXdrSize = parseInt(process.env.FLUID_MAX_XDR_SIZE || "10240", 10);
  const maxOperations = parseInt(process.env.FLUID_MAX_OPERATIONS || "100", 10);

  const vaultAddr = process.env.VAULT_ADDR;
  const vaultToken = process.env.VAULT_TOKEN;
  const vaultAppRoleRoleId = process.env.VAULT_APPROLE_ROLE_ID;
  const vaultAppRoleSecretId = process.env.VAULT_APPROLE_SECRET_ID;
  const vaultKvMount = process.env.FLUID_VAULT_KV_MOUNT || "secret";
  const vaultKvVersionRaw = process.env.FLUID_VAULT_KV_VERSION || "2";
  const vaultKvVersion = (vaultKvVersionRaw === "1" ? 1 : 2) as 1 | 2;
  const vaultSecretField =
    process.env.FLUID_FEE_PAYER_VAULT_SECRET_FIELD || "secret";

  const vaultConfigured =
    !!vaultAddr &&
    (!!vaultToken || (!!vaultAppRoleRoleId && !!vaultAppRoleSecretId));

  const vaultSecretPathsRaw = process.env.FLUID_FEE_PAYER_VAULT_SECRET_PATHS;
  const vaultSecretPaths = vaultSecretPathsRaw
    ? vaultSecretPathsRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  const vaultPublicKeysRaw = process.env.FLUID_FEE_PAYER_PUBLIC_KEYS;
  const vaultPublicKeys = vaultPublicKeysRaw
    ? vaultPublicKeysRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  if (
    vaultConfigured &&
    vaultSecretPaths.length > 0 &&
    vaultPublicKeys.length > 0
  ) {
    if (vaultSecretPaths.length !== vaultPublicKeys.length) {
      throw new Error("Vault mode requires paths and public keys to match 1:1");
    }

    const vault: VaultConfig = {
      addr: vaultAddr!,
      token: vaultToken,
      appRole: vaultToken
        ? undefined
        : { roleId: vaultAppRoleRoleId!, secretId: vaultAppRoleSecretId! },
      kvMount: vaultKvMount,
      kvVersion: vaultKvVersion,
      secretField: vaultSecretField,
    };

    const feePayerAccounts: FeePayerAccount[] = vaultPublicKeys.map(
      (publicKey, i) => ({
        publicKey,
        keypair: StellarSdk.Keypair.fromPublicKey(publicKey),
        secretSource: { type: "vault", secretPath: vaultSecretPaths[i] },
      }),
    );

    return {
      feePayerAccounts,
      baseFee,
      feeMultiplier,
      networkPassphrase,
      horizonUrl,
      maxXdrSize,
      maxOperations,
      allowedOrigins,
      rateLimitWindowMs,
      rateLimitMax,
      vault,
    };
  }

  const feePayerSecretsEnvRaw = process.env.FLUID_FEE_PAYER_SECRET;
  const feePayerSecretsEnv = feePayerSecretsEnvRaw
    ? feePayerSecretsEnvRaw
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  if (feePayerSecretsEnv.length === 0) {
    throw new Error("No fee payer secrets configured.");
  }

  const feePayerAccounts: FeePayerAccount[] = feePayerSecretsEnv.map(
    (secret: string) => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      return {
        publicKey: keypair.publicKey(),
        keypair,
        secretSource: { type: "env", secret },
      };
    },
  );

  return {
    feePayerAccounts,
    baseFee,
    feeMultiplier,
    networkPassphrase,
    horizonUrl,
    maxXdrSize,
    maxOperations,
    allowedOrigins,
    rateLimitWindowMs,
    rateLimitMax,
  };
}

let rrIndex = 0;
export function pickFeePayerAccount(config: Config): FeePayerAccount {
  const accounts = config.feePayerAccounts;
  const account = accounts[rrIndex % accounts.length];
  rrIndex = (rrIndex + 1) % accounts.length;
  return account;
}
