import { Client } from "../src/client";
import { InternetIdentity } from "../src/identity-providers";

describe("Client", () => {
  it("should instantiate correctly", async () => {
    const config = {
      agent: {
        host: "http://127.0.0.1:4943"
      },
      canisters: {},
      identityProviders: {},
    };

    const client = Client.create(config);

    expect(client).toBeDefined();
    expect(client instanceof Client).toBe(true);

    expect(client.getIdentity()).toBeDefined();
    expect(client.getIdentityProviders()).toBeDefined();

    expect(client.getIdentity().getPrincipal().isAnonymous()).toBe(true);
  });

  it("should assign a identity correctly", async () => {
    const internetIdentity = new InternetIdentity({
      providerUrl: process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL,
    });

    const config = {
      agent: {
        host: "http://127.0.0.1:4943"
      },
      canisters: {},
      identityProviders: {
        "internet_identity": internetIdentity
      },
    };

    const client = Client.create(config);

    const identityProvider = client.getIdentityProviders()["internet_identity"];
    await identityProvider.init();

    const identity = client.getIdentityProviders()["internet_identity"].getIdentity();

    await client.init(identity);

    expect(client.getIdentity().getPrincipal().toString()).toBe(
      identity.getPrincipal().toString()
    );
  });
});
