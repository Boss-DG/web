import { Address } from 'viem';

export const nodeEnv = process.env.NODE_ENV;
export const docsUrl = process.env.DOCS_URL ?? 'https://docs.base.org';
export const bridgeUrl = process.env.BRIDGE_URL ?? 'https://bridge.base.org';
export const greenhouseApiUrl =
  process.env.GREENHOUSE_HTTPS ?? 'https://boards-api.greenhouse.io/v1';
export const mainnetLaunchBlogPostURL =
  process.env.MAINNET_LAUNCH_BLOG_POST_URL ?? 'https://base.mirror.xyz/';
export const mainnetLaunchFlag = process.env.MAINNET_LAUNCH_FLAG ?? 'false';
export const isDevelopment = nodeEnv === 'development';

// trusted signer
export const trustedSignerAddress = (process.env.TRUSTED_SIGNER_ADDRESS as Address) ?? '0x';
export const trustedSignerPKey = (process.env.TRUSTED_SIGNER_PRIVATE_KEY as Address) ?? '0x';

// attestations
export const verifiedAccountSchemaId = process.env.VERIFICATION_VERIFIED_ACCOUNT_SCHEMA_ID;
export const verifiedCb1AccountSchemaId = process.env.VERIFICATION_VERIFIED_CB1_ACCOUNT_SCHEMA_ID;
