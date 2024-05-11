import { Actor, ActorSubclass, HttpAgent, HttpAgentOptions, Identity, SignIdentity } from "@dfinity/agent";
import { DelegationChain, PartialIdentity } from "@dfinity/identity";
import { EventEmitter as EventManager } from "events";

import restClient, { RestClientInstance } from "@bundly/ares-rest";

import { EventEmitter, EventListener } from "../events";
import { ClientStorageInterface, LocalStorage } from "../storage";
import * as url from "../utils/url";
import { AgentNotDefinedError, CanisterDoesNotExistError, ProviderNotFoundError } from "./client.errors";
import {
  ClientConfig,
  CreateClientConfig,
  GetCandidActorOptions,
  GetIdentitiesResult,
  IdentityMap,
  IdentityProviders,
} from "./client.types";
import { IdentityManager } from "./identity-manager";
import { IdentityProvider } from "./identity-provider";

export class Client {
  private identities: IdentityMap = new Map();
  private identityManager: IdentityManager;
  public eventEmitter: EventEmitter;
  public eventListener: EventListener;
  private storage: ClientStorageInterface;
  private eventManager = new EventManager();

  private constructor(private readonly config: ClientConfig) {
    this.eventEmitter = new EventEmitter(this.eventManager);
    this.eventListener = new EventListener(this.eventManager);

    this.storage = config.storage;
    this.identityManager = new IdentityManager(this.storage);
  }

  public async init(): Promise<void> {
    await this.loadStoredIdentities();
  }

  private createAgent(options: HttpAgentOptions): HttpAgent {
    const agent = new HttpAgent(options);

    // Host is defined in createAgentOptions
    url.isLocal(options.host!) && agent.fetchRootKey().then(() => console.log("Root key fetched"));

    return agent;
  }

  private async loadStoredIdentities(): Promise<void> {
    const identities = await this.identityManager.getAll();

    identities.forEach((values, principal) => {
      this.identities.set(principal, {
        identity: values.identity,
        provider: values.provider,
      });
    });
  }

  public getIdentities(): GetIdentitiesResult {
    const identities = Array.from(this.identities.values()).map(({ identity, provider }) => {
      return {
        identity,
        provider,
      };
    });

    return identities;
  }

  public async addIdentity(
    keyIdentity: SignIdentity | PartialIdentity,
    delegationChain: DelegationChain,
    provider: string
  ): Promise<void> {
    try {
      await this.identityManager.persist(keyIdentity, delegationChain, provider);

      this.identities.set(keyIdentity.getPrincipal().toString(), {
        identity: keyIdentity,
        provider,
      });

      this.eventEmitter.identityAdded(keyIdentity, provider);
    } catch (error) {
      throw error;
    }
  }

  public async removeIdentity(identity: Identity): Promise<void> {
    await this.identityManager.remove(identity);
    this.identities.delete(identity.getPrincipal().toString());
    this.eventEmitter.identityRemoved(identity);
  }

  private createAgentOptions(identity: Identity, agentConfig?: HttpAgentOptions) {
    const baseOptions = agentConfig || this.config.agentConfig;

    if (!baseOptions) {
      throw new AgentNotDefinedError();
    }

    const options = {
      ...baseOptions,
      host: baseOptions.host || "http://localhost:4943",
      identity,
    };

    return options;
  }

  // TODO: Options should be optional?
  public getCandidActor(name: string, identity: Identity, options?: GetCandidActorOptions): ActorSubclass {
    const canister = this.config.candidCanisters?.get(name);

    if (!canister) {
      throw new CanisterDoesNotExistError(name);
    }

    const agentOptions = this.createAgentOptions(identity, canister.agentConfig);
    const agent = this.createAgent({
      ...agentOptions,
    });

    url.isLocal(agentOptions.host) && agent.fetchRootKey().then(() => console.log("Root key fetched"));

    const actor = Actor.createActor(canister.idlFactory, {
      ...canister.actorConfig,
      canisterId: options?.canisterId || canister.actorConfig.canisterId,
      agent,
    });

    return actor;
  }

  public getRestActor(name: string, identity: Identity): RestClientInstance {
    const canister = this.config.restCanisters?.get(name);

    if (!canister) {
      throw new CanisterDoesNotExistError(name);
    }

    // TODO: Modify restClient to accept an agent optionally
    const actor = restClient.create({
      baseURL: canister?.baseUrl,
      identity,
    });

    return actor;
  }

  public getProviders(): IdentityProviders {
    return this.config.providers || [];
  }

  public getProvider(name: string): IdentityProvider {
    const provider = this.getProviders().find((provider) => provider.name === name);

    if (!provider) {
      throw new ProviderNotFoundError(name);
    }

    return provider;
  }

  public static create(config: CreateClientConfig): Client {
    if (!config.storage) {
      config.storage = new LocalStorage();
    }

    return new Client(config as ClientConfig);
  }
}
