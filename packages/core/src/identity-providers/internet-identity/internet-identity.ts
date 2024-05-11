import { Identity } from "@dfinity/agent";
import { AuthClient, AuthClientStorage, KEY_STORAGE_DELEGATION, KEY_STORAGE_KEY } from "@dfinity/auth-client";
import { StoredKey } from "@dfinity/auth-client/lib/cjs/storage";
import { DelegationChain, Ed25519KeyIdentity, isDelegationValid } from "@dfinity/identity";

import { Client } from "../../client";
import { ED25519_KEY_LABEL, IdentityProvider } from "../../client/identity-provider";
import { InternetIdentityCreateOptions } from "./internet-identity.types";

// Set default maxTimeToLive to 8 hours
const DEFAULT_MAX_TIME_TO_LIVE = /* hours */ BigInt(8) * /* nanoseconds */ BigInt(3_600_000_000_000);

export class TempStorage implements AuthClientStorage {
  private storage = new Map<string, StoredKey>();

  public get(key: string): Promise<StoredKey> {
    const value = this.storage.get(key) as StoredKey;
    return Promise.resolve(value);
  }

  public set(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  public remove(key: string): Promise<void> {
    this.storage.delete(key);
    return Promise.resolve();
  }
}

export class InternetIdentity implements IdentityProvider {
  public readonly name = "internet-identity";
  public readonly displayName = "Internet Identity";
  // TODO: Add logo svg
  public readonly logo = "";
  private client: Client | undefined;
  private authClient: AuthClient | undefined;
  private storage: AuthClientStorage = new TempStorage();

  constructor(private readonly config?: InternetIdentityCreateOptions) {}

  public async init(client: Client): Promise<void> {
    this.client = client;

    this.authClient = await AuthClient.create({
      storage: this.storage,
      keyType: ED25519_KEY_LABEL,
    });
  }

  public connect() {
    if (!this.authClient || !this.client) throw new Error("init must be called before this method");

    return new Promise<void>((resolve, reject) => {
      try {
        this.authClient!.login({
          identityProvider: this.config?.identityProvider,
          // TODO: allow to set maxTimeToLive from options
          maxTimeToLive: this.config?.maxTimeToLive || DEFAULT_MAX_TIME_TO_LIVE,
          onSuccess: async () => {
            const maybeIdentityStorage = await this.storage.get(KEY_STORAGE_KEY);
            const maybeDelegationStorage = await this.storage.get(KEY_STORAGE_DELEGATION);
            let delegationChain: DelegationChain | undefined;
            let keyIdentity: Ed25519KeyIdentity | undefined;

            if (typeof maybeIdentityStorage === "string") {
              keyIdentity = Ed25519KeyIdentity.fromJSON(maybeIdentityStorage);
            } else {
              reject("Identity storage not found or invalid");
            }

            if (typeof maybeDelegationStorage === "string") {
              delegationChain = DelegationChain.fromJSON(maybeDelegationStorage);

              if (!isDelegationValid(delegationChain)) {
                reject("Invalid delegation chain found in storage");
              }
            } else {
              reject("Delegation storage not found or invalid");
            }

            if (keyIdentity && delegationChain) {
              this.client?.addIdentity(keyIdentity, delegationChain, this.name);
              this.storage.remove(KEY_STORAGE_KEY);
              this.storage.remove(KEY_STORAGE_DELEGATION);
              resolve();
            }

            reject("Identity or delegation chain not found");
          },
          onError: (reason) => {
            reject(new Error(reason));
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  public async disconnect(identity: Identity): Promise<void> {
    if (!this.authClient || !this.client) throw new Error("init must be called before this method");

    try {
      await this.authClient.logout();
      this.client.removeIdentity(identity);
    } catch (error) {
      throw error;
    }
  }
}
