# Payments

Money moves through three parties the application does not control: the customer's bank, a payment service provider, and the card networks. The job is to never hold card data, to treat the provider's webhook as the truth, and to make every operation safe to repeat. The checks are in [payments-and-webhooks](protocols/payments-and-webhooks.md).

## Vocabulary

- **Provider**: the payment service that takes the card and settles the money. The only integration point.
- **Payment intent, preference or order**: the provider-side object for one attempt to charge an amount, created by the server.
- **Webhook**: the provider calling the server to say what happened. The source of truth for state.
- **Idempotency key**: a unique string per operation so a retry cannot charge twice.
- **Card-data scope**: how much of the card industry rules apply. Hosted checkout or provider-rendered fields keep it at its smallest; touching a card number directly puts it at its largest.

## The flow

The server creates the charge with the amount it computed itself from the catalog, never an amount sent by the client. The client only confirms. The order becomes paid when the verified webhook says so, never when the browser returns to a success URL, a query parameter says so, or a client call claims it.

## Amounts

Amounts are integers in minor units, with the currency stored next to them. A float is never used for money. Price, quantity, discount, voucher, plan, tax and shipping are recomputed on the server.

## Webhooks received

Every webhook is verified against the provider's signature with the webhook secret before its body is used, the timestamp is checked against replay, and the event identifier is stored so the same event applied twice does nothing. The handler answers 200 fast and does the work after. Providers retry and do not guarantee order, so handlers are idempotent state transitions: if the order is already paid, the event is ignored.

During a rotation of the webhook secret, the signature is checked against the current and the previous secret, and the previous one is removed when the window closes.

## Calls to the provider

Every create or capture call carries an idempotency key derived from the order identifier, so a network timeout followed by a retry produces one charge.

## State

The order is a state machine: created, pending, paid, failed, refunded, partially refunded, disputed. Refunds and disputes are states, never deletions, and a chargeback can arrive weeks later.

Subscriptions are billed by the provider, and the application mirrors the state from webhooks: trialing, active, past due, canceled, unpaid. Entitlements are computed from the mirrored state, never from whether the last payment succeeded. Proration, cancellation at period end or immediately, a grace period for failed renewals and dunning messages are each decided explicitly.

## Card data

A card number, a security code or track data is never stored. The provider's token or customer identifier is stored instead, and the checkout stays on hosted or tokenized fields so the card-data scope stays at its smallest.

## Reconciliation

A daily job compares orders against the provider's list of charges and payouts and flags anything that disagrees. Receipts and invoices follow the law of the customer's country and are a separate integration from the charge itself.

## Testing

Test mode end to end with the provider's test cards, including the failure cards for a decline, insufficient funds and a required authentication step, and a replayed webhook. A pass never enters a real card number, per [rules-of-engagement.md](rules-of-engagement.md).
