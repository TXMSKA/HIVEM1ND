# Payments

Money moves through three parties the application does not control: the customer's bank, a payment service provider, and the card networks. The job is to never hold card data, to take the paid state from the provider, and to make every operation safe to repeat. The checks are in [payments-and-webhooks](protocols/payments-and-webhooks.md).

## Vocabulary

- Provider: the payment service that takes the card and settles the money. The only integration point.
- Payment intent, preference or order: the provider-side object for one attempt to charge an amount, created by the server.
- Webhook: the provider calling the server to say what happened.
- Idempotency key: a unique string per operation so a retry cannot charge twice.
- Card-data scope: how much of the card industry rules apply. Hosted checkout or provider-rendered fields keep it at its smallest; touching a card number directly puts it at its largest.

## The flow

The server creates the charge with the amount it computed itself from the catalog, never an amount sent by the client, and the client only confirms. An order becomes paid by the verified webhook. When a webhook did not arrive, a server-side fetch of that payment from the provider by its identifier may reconcile it, applying the same transition the webhook would. Nothing from the client ever marks it paid: not a return to a success URL, a query parameter or a client call.

## Amounts

Amounts are integers in minor units, with the currency stored next to them. A float is never used for money. Price, quantity, discount, voucher, plan, tax and shipping are recomputed on the server.

## Webhooks received

Every webhook is verified before its body is used, and the handler is an idempotent state transition, since providers retry and do not guarantee order. The values are in [essentials.md](essentials.md#default-values). In order:

1. Read the raw body before any parser touches it, since the signature covers the exact bytes.
2. Verify the signature with the current and, during a rotation, the previous secret, comparing in constant time, and check the timestamp against the tolerance. A failure answers 400 and changes nothing.
3. Map the event to the local record through the identifier the server stored when it created the provider object, never through a value the client supplied at checkout.
4. Answer unknown things with 2xx and a logged warning. An event for a record that does not exist, or of a type the handler does not handle, is acknowledged so the provider stops retrying, and nothing changes.
5. Compare amount and currency with the record. A signed event for a smaller amount or another currency never settles the order; it is logged and flagged for reconciliation.
6. Insert the event identifier and apply the transition in one short transaction, as a conditional update from the expected state. A duplicate identifier ends the transaction with nothing changed.
7. Decide order by precedence, not by arrival. Terminal states win over earlier ones, such as refunded over paid and paid over pending; an event never moves a record backwards. The provider's timestamps can share a second, so they do not order events on their own.
8. Answer 2xx once the transaction commits, and push slow work, such as mail or fulfilment calls, to a queue behind it.

The previous secret is removed when the rotation window closes.

## Calls to the provider

Every create or capture call carries an idempotency key derived from the order identifier, so a network timeout followed by a retry produces one charge.

## State

The order is a state machine: created, pending, paid, failed, refunded, partially refunded, disputed. Refunds and disputes are states, never deletions, and a chargeback can arrive weeks later.

Subscriptions are billed by the provider, and the application mirrors the state from verified webhooks: trialing, active, past due, canceled, unpaid. Entitlements are computed on the server from the mirrored state, never from a plan named in a request or from whether the last payment succeeded. Proration, cancellation at period end or immediately, a grace period for failed renewals and dunning messages are each decided explicitly.

## Card data

A card number, a security code or track data is never stored. The provider's token or customer identifier is stored instead, and the checkout stays on hosted or tokenized fields.

## Reconciliation

A daily job compares orders against the provider's list of charges and payouts and flags anything that disagrees. Receipts and invoices follow the law of the customer's country and are a separate integration from the charge itself.

## Testing

Test mode end to end with the provider's test cards, including the failure cards for a decline, insufficient funds and a required authentication step, and a replayed webhook. A pass never enters a real card number, per [rules-of-engagement.md](rules-of-engagement.md#what-a-pass-may-never-do).
