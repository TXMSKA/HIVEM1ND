# Payments

Everything that moves money: prices, checkout, the provider's webhooks, subscriptions and entitlements, refunds, card data and reconciliation. The flow and its vocabulary are in [payments.md](../payments.md).

## Prices and amounts

Applies when: a checkout, cart, order, discount, voucher, tax or shipping calculation is added or changed; the client sends anything that touches money.

Build: The order endpoint accepts product identifiers and positive bounded integer quantities only. The server looks up every price, computes the total in integer minor units and stores the currency beside it.

Options:

- **Recompute every amount on the server from the catalog.** The only option.

Open: steps 1 and 2 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); step 2 of [business-logic](../protocols/business-logic.md) for a voucher spent twice.

## Checkout and fulfilment

Applies when: a success page, a return URL, an access grant or a fulfilment step is built; the order state changes.

Build: The server creates the provider object with its own amount and an idempotency key derived from the order identifier, and the order becomes paid as [payments.md](../payments.md#the-flow) sets out.

Options:

- **Server creates the charge, client confirms, verified webhook marks paid.** The default.
- **Reconciliation that fetches the payment from the provider by its identifier.** When a webhook did not arrive; it applies the same transition the webhook would.

Open: step 5 of [payments-and-webhooks](../protocols/payments-and-webhooks.md).

## Inbound webhooks

Applies when: a webhook handler is added; the webhook secret rotates; events arrive twice or out of order.

Build: Follow [payments.md](../payments.md#webhooks-received), with the tolerance from [essentials.md](../essentials.md#default-values).

Options:

- **Signature over the raw body, timestamp window, stored event identifier.** Always, before the body is used.
- **Current and previous secret during a rotation window.** When rotating.

Open: steps 3 and 4 of [payments-and-webhooks](../protocols/payments-and-webhooks.md).

## Subscriptions, entitlements, refunds and disputes

Applies when: subscriptions, trials, renewals, plan changes, refunds, partial refunds or disputes are added; a paid feature checks access.

Build: Mirror the provider's subscription state from verified webhooks into its own table, compute entitlements on the server from that table only, and record refunds and disputes as states, never deletions.

Options:

- **Mirror the provider's subscription state from webhooks, and compute entitlements from it.** The default.
- **Proration, cancellation timing, grace period and dunning.** Each decided explicitly by a person, never left to a default nobody chose.

Open: steps 4 and 7 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); [payments.md](../payments.md#state).

## Card data and reconciliation

Applies when: the checkout type changes; any field could hold card data; a reconciliation or payout report is built.

Build: Use hosted checkout, store only the provider's token or customer identifier, and schedule a daily job that compares orders with the provider's charges.

Options:

- **Hosted checkout.** The smallest card-data scope.
- **Provider-rendered fields inside the page.** A slightly larger scope, more control over the page.
- **Handling card numbers directly.** The largest scope. Avoided.
- **Daily reconciliation against the provider.** Always.

Open: step 6 of [payments-and-webhooks](../protocols/payments-and-webhooks.md); [payments.md](../payments.md#card-data).
