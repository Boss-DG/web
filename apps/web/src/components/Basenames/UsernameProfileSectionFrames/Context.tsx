'use client';
import {
  fallbackFrameContext,
  FarcasterFrameContext,
  OnSignatureFunc,
  OnTransactionFunc,
  SignerStateInstance,
} from '@frames.js/render';
import { useAnonymousIdentity, type AnonymousSigner } from '@frames.js/render/identity/anonymous';
import {
  FarcasterSignerInstance,
  useFarcasterFrameContext,
  useFarcasterIdentity,
} from '@frames.js/render/identity/farcaster';
import { useFrame } from '@frames.js/render/use-frame';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAnalytics } from 'apps/web/contexts/Analytics';
import { useErrors } from 'apps/web/contexts/Errors';
import L2ResolverAbi from 'apps/web/src/abis/L2Resolver';
import { USERNAME_L2_RESOLVER_ADDRESSES } from 'apps/web/src/addresses/usernames';
import { useUsernameProfile } from 'apps/web/src/components/Basenames/UsernameProfileContext';
import useBasenameChain, { isBasenameSupportedChain } from 'apps/web/src/hooks/useBasenameChain';
import useReadBaseEnsTextRecords from 'apps/web/src/hooks/useReadBaseEnsTextRecords';
import { UsernameTextRecordKeys } from 'apps/web/src/utils/usernames';
import { ActionType } from 'libs/base-ui/utils/logEvent';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { namehash } from 'viem';
import { useAccount, useChainId, useConfig, useWriteContract } from 'wagmi';
import { sendTransaction, signTypedData, switchChain } from 'wagmi/actions';

class InvalidChainIdError extends Error {}
class CouldNotChangeChainError extends Error {}

function isValidChainId(id: string): boolean {
  return id.startsWith('eip155:');
}

function parseChainId(id: string): number {
  if (!isValidChainId(id)) {
    throw new InvalidChainIdError(`Invalid chainId ${id}`);
  }

  return parseInt(id.split('eip155:')[1]);
}

export type FrameContextValue = {
  currentWalletIsProfileOwner?: boolean;
  frameUrlRecord: string;
  frameInteractionError: string;
  setFrameInteractionError: (s: string) => void;
  frameConfig: Omit<
    Parameters<typeof useFrame>[0],
    'homeframeUrl' | 'signerState' | 'frameContext'
  > & {
    frameContext: FarcasterFrameContext;
  };
  farcasterSignerState: FarcasterSignerInstance;
  anonSignerState: SignerStateInstance<AnonymousSigner>;
  showFarcasterQRModal: boolean;
  pendingFrameChange: boolean;
  setShowFarcasterQRModal: (b: boolean) => void;
  setFrameRecord: (url: string) => Promise<`0x${string}` | undefined>;
};

export const FrameContext = createContext<FrameContextValue | null>(null);

export const useFrameContext = () => {
  const context = useContext(FrameContext);
  if (!context) {
    throw new Error('useFrameContext must be used within a FramesProvider');
  }
  return context;
};

type FramesProviderProps = {
  children: React.ReactNode;
};

export function FramesProvider({ children }: FramesProviderProps) {
  const [showFarcasterQRModal, setShowFarcasterQRModal] = useState(false);
  const { logEventWithContext } = useAnalytics();
  const { address } = useAccount();
  const { logError } = useErrors();
  const { profileUsername, profileAddress, currentWalletIsProfileOwner } = useUsernameProfile();
  const { existingTextRecords, refetchExistingTextRecords } = useReadBaseEnsTextRecords({
    address: profileAddress,
    username: profileUsername,
    refetchInterval: currentWalletIsProfileOwner ? 1000 * 5 : Infinity,
  });

  const frameUrlRecord = existingTextRecords[UsernameTextRecordKeys.Frames];
  const { frameContext: farcasterFrameContext } = useFarcasterFrameContext({
    fallbackContext: fallbackFrameContext,
  });

  const anonSignerState = useAnonymousIdentity();
  const farcasterSignerState = useFarcasterIdentity({
    signerUrl: '/frames/signer',
    onMissingIdentity() {
      logEventWithContext('basename_profile_frame_farcaster_sign_in_rendered', ActionType.render);
      setShowFarcasterQRModal(true);
    },
  });

  const currentChainId = useChainId();
  const config = useConfig();
  const { openConnectModal } = useConnectModal();
  const [frameInteractionError, setFrameInteractionError] = useState('');

  const onTransaction: OnTransactionFunc = useCallback(
    async ({ transactionData }) => {
      if (!address) {
        openConnectModal?.();
        return null;
      }

      const { params, chainId } = transactionData;
      const requestedChainId = parseChainId(chainId);
      try {
        if (currentChainId !== requestedChainId) {
          await switchChain(config, {
            chainId: requestedChainId,
          }).catch((e) => {
            throw new CouldNotChangeChainError(e.message as string);
          });
        }

        const transactionId = await sendTransaction(config, {
          to: params.to,
          data: params.data,
          value: BigInt(params.value ?? 0),
        });
        logEventWithContext('basename_profile_frame_transacted', ActionType.process, {
          context: `value: ${params.value}`,
        });
        return transactionId;
      } catch (error) {
        if (error instanceof InvalidChainIdError) {
          setFrameInteractionError('Invalid chain id');
          logEventWithContext('basename_profile_frame_invalid_chain_id', ActionType.error);
        } else if (error instanceof CouldNotChangeChainError) {
          logEventWithContext('basename_profile_frame_could_not_change_chain', ActionType.error);
          setFrameInteractionError(`Must switch chain to ${requestedChainId}`);
        } else {
          setFrameInteractionError('Error sending transaction');
        }

        logError(error, 'failed to complete a frame transaction');

        return null;
      }
    },
    [address, config, currentChainId, openConnectModal],
  );
  const onError = useCallback((e: Error) => {
    logError(e, 'frame error');
  }, []);
  const onSignature: OnSignatureFunc = useCallback(
    async ({ signatureData }) => {
      if (!address) {
        openConnectModal?.();
        console.info('Opened connect modal because the account address is not set');

        return null;
      }

      try {
        const { params, chainId } = signatureData;
        const requestedChainId = parseChainId(chainId);

        if (currentChainId !== requestedChainId) {
          await switchChain(config, {
            chainId: requestedChainId,
          }).catch((e) => {
            throw new CouldNotChangeChainError(e.message as string);
          });
        }

        return await signTypedData(config, params);
      } catch (error) {
        if (error instanceof InvalidChainIdError) {
          setFrameInteractionError('Invalid chain id');
        } else if (error instanceof CouldNotChangeChainError) {
          setFrameInteractionError('Could not change chain');
        } else {
          setFrameInteractionError('Error signing data');
        }

        console.error(error);

        return null;
      }
    },
    [address, openConnectModal, currentChainId, config],
  );

  const { writeContractAsync, isPending: pendingFrameChange } = useWriteContract();
  const { basenameChain } = useBasenameChain(profileUsername);
  const setFrameRecord = useCallback(
    async (frameUrl: string) => {
      async function doTransaction() {
        if (frameUrl === 'undefined') return;
        if (!address) {
          openConnectModal?.();
          return;
        }
        if (!isBasenameSupportedChain(currentChainId)) {
          await switchChain(config, {
            chainId: basenameChain.id,
          }).catch((e) => {
            throw new CouldNotChangeChainError(e.message as string);
          });
        }
        const nameHash = namehash(profileUsername);
        const result = await writeContractAsync({
          abi: L2ResolverAbi,
          chainId: basenameChain.id,
          address: USERNAME_L2_RESOLVER_ADDRESSES[basenameChain.id],
          args: [nameHash, UsernameTextRecordKeys.Frames, frameUrl.trim()],
          functionName: 'setText',
        });
        refetchExistingTextRecords().catch(console.warn);
        return result;
      }
      return doTransaction();
    },
    [
      address,
      profileUsername,
      basenameChain,
      writeContractAsync,
      config,
      currentChainId,
      openConnectModal,
      refetchExistingTextRecords,
    ],
  );

  const value = useMemo(
    () => ({
      currentWalletIsProfileOwner,
      frameUrlRecord,
      anonSignerState,
      farcasterSignerState,
      frameConfig: {
        connectedAddress: address,
        frameActionProxy: '/frames',
        frameGetProxy: '/frames',
        onTransaction,
        onError,
        onSignature,
        onConnectWallet: openConnectModal,
        frameContext: farcasterFrameContext,
      },
      frameInteractionError,
      setFrameInteractionError,
      showFarcasterQRModal,
      setShowFarcasterQRModal,
      pendingFrameChange,
      setFrameRecord,
    }),
    [
      currentWalletIsProfileOwner,
      frameUrlRecord,
      anonSignerState,
      farcasterSignerState,
      address,
      onTransaction,
      onError,
      onSignature,
      openConnectModal,
      farcasterFrameContext,
      frameInteractionError,
      showFarcasterQRModal,
      pendingFrameChange,
      setFrameRecord,
    ],
  );

  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}