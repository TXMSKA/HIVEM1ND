name: payments-and-webhooks
purpose: Prove the server decides every amount, an inbound webhook is authentic and cannot act twice, and access follows the subscription the provider holds.
scope: checkout, prices, quantities, discounts, vouchers, subscriptions, entitlements, refunds, calls to the payment provider and inbound webhook handlers
trigger: task close
repeat: once
inputs: the checkout and order handlers, the webhook handlers, the entitlement checks, the provider's test mode, test accounts created for the pass, the test store
stop: an amount sent by the client is charged or stored as sent, or an unsigned webhook is accepted, which is reported at once and ends the protocol
report: the price fields read from the request per handler, the tampered order results, the webhook signature results, the replay result read from the store, the return URL result, the card data search, the reconciliation job, and the entitlement results per subscription state

## Steps

1. List every value the client sends that touches money.
   Task: search the checkout, cart, order and subscription handlers for every field read from the request: amount, unit price, currency, quantity, discount, voucher code, plan, tax and shipping.
   Time: 30 minutes. Repository.
   Result: a table of handler and field, with the server-side source each field is recomputed from. A field used as sent is a finding.

2. Recompute on the server and tamper to prove it.
   Task: with a test account against the provider's test mode, send an order with a lowered price, a negative quantity, a discount the account does not hold and a currency changed after the total was shown.
   Time: 30 minutes. Running application, provider test mode only.
   Result: per tampered request, the status code and the stored order row read from the store, showing the server's amount rather than the sent one, and the amount the provider recorded matching the stored row.

3. Verify every webhook signature before reading the body.
   Task: read each handler against [payments.md](../payments.md#webhooks-received). Then send it a request with no signature, one with a wrong signature, and one carrying the signature captured from a test-mode delivery over a modified body, so no secret is handled.
   Time: 30 minutes. Repository, plus running application.
   Result: all three rejected with their status codes and the store unchanged after each, read from the store. The source shows, with file references, the raw body verified in constant time within the timestamp window, the amount and currency compared with the local record before any state changes, and an unknown record or event type answered 2xx and logged.

4. Make the handler idempotent.
   Task: replay a captured test-mode delivery twice inside the timestamp window, or resend it from the provider's test-mode dashboard, and deliver two events for the same payment out of order.
   Time: 20 minutes. Running application, provider test mode only.
   Result: the store read after the replay showing one charge, one grant or one fulfilment, keyed on the provider's event identifier and stored in the same transaction as the state change, and the out-of-order pair leaving the record in the state the precedence rule in [payments.md](../payments.md#webhooks-received) gives. Every create or capture call to the provider carries an idempotency key derived from the order identifier, quoted from the source with a file reference.

5. Take the paid state from the provider, never from the client.
   Task: read where an order becomes paid and where access is granted or a refund applied, against [payments.md](../payments.md#the-flow). Then request the success return URL with no completed payment, and send a client message claiming the payment succeeded.
   Time: 20 minutes. Repository, plus running application.
   Result: the transitions to paid found only in the verified webhook handler and in a reconciliation that fetches that payment from the provider by its identifier, each with file and line, and both requests granting nothing, recorded with the store read after them.

6. Keep card data off the servers and reconcile against the provider.
   Task: search the source and the schema for fields holding card data: `git grep -n -I -i -E 'card_?number|cardnum|ccnum|cvv|cvc|security_?code|track_?data'`, with a planted `card_number` column as the positive control; the logs are searched with the same expression in step 5 of [logging-and-errors](logging-and-errors.md). Confirm the checkout uses hosted or provider-rendered fields, and read the reconciliation job that compares orders against the provider's charges and payouts.
   Time: 25 minutes. Repository, plus the data store.
   Result: zero hits for stored card data, the checkout type named, and the reconciliation job's last run with the number of disagreements it flagged. A missing reconciliation job is a finding at P2.

7. Compute entitlements from the mirrored subscription state.
   Task: read where access to a paid feature is decided: on the server, from the subscription state mirrored from verified webhooks as [payments.md](../payments.md#state) sets out, never from a plan named in the request, a client flag or whether the last payment succeeded. Then, in the provider's test mode, move a test subscription to past due, canceled and unpaid, change it to a cheaper plan, start a second trial on the same account, and send a request that names a higher plan.
   Time: 30 minutes. Repository, plus running application, provider test mode only.
   Result: the entitlement check quoted with file and line, and per state the access granted or refused at the moment the recorded policy says, read from the response and the entitlement row; the downgrade removing the higher features, the second trial refused, and the request naming a higher plan granting nothing. Needs a person: the grace period and the cancellation timing, when no decision is recorded.
