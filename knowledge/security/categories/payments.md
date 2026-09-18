# Payments

Everything that moves money: prices, checkout, the provider's webhooks, subscriptions, refunds, card data and reconciliation. The flow and its vocabulary are in [payments.md](../payments.md).

## Prices and amounts

**Applies when:** a checkout, cart, order, discount, voucher, tax or shipping calculation is added or changed; the client sends anything that touches money.

**Options:**

- **Recompute every amount on the server from the catalog.** The only option. Amounts are integers in minor units with the currency beside them.

**Open:** steps 1 and 2 of [payments-and-webhooks](../protocols/payments-and-webhooks.md).

## Checkout and fulfilment

**Applies when:** a success page, a return URL, an access grant or a fulfilment step is built; the order state changes.

**Options:**

- **Server creates the charge, client confirms, verified webhook marks paid.** The default.
- **Server-side call to the provider to confirm state.** When a webhook cannot be received, such as during local development. Never the return URL or a client message.

**Open:** step 5 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); [payments.md](../payments.md#the-flow).

## Inbound webhooks

**Applies when:** a webhook handler is added; the webhook secret rotates; events arrive twice or out of order.

**Options:**

- **Signature over the raw body, timestamp window, stored event identifier.** Always, before the body is used.
- **Current and previous secret during a rotation window.** When rotating.

**Open:** steps 3 and 4 of [payments-and-webhooks](../protocols/payments-and-webhooks.md).

## Subscriptions, refunds and disputes

**Applies when:** subscriptions, trials, renewals, refunds, partial refunds or disputes are added; entitlements are computed.

**Options:**

- **Mirror the provider's subscription state from webhooks, and compute entitlements from it.** The default.
- **Proration, cancellation timing, grace period and dunning.** Each decided explicitly by a person, never left to a default nobody chose.

**Open:** step 4 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); [payments.md](../payments.md#state).

## Card data and reconciliation

**Applies when:** the checkout type changes; any field could hold card data; a reconciliation or payout report is built.

**Options:**

- **Hosted checkout.** The smallest card-data scope.
- **Provider-rendered fields inside the page.** A slightly larger scope, more control over the page.
- **Handling card numbers directly.** The largest scope. Avoided.
- **Daily reconciliation against the provider.** Always.

**Open:** step 6 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); [payments.md](../payments.md#card-data).
