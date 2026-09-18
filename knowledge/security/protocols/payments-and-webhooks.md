name: payments-and-webhooks
purpose: Prove the server decides every amount, and that an inbound webhook is authentic and cannot act twice.
scope: checkout, prices, quantities, discounts, vouchers, subscriptions, refunds, calls to the payment provider and inbound webhook handlers
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, before every launch, and again whenever a price path or a webhook handler is added
inputs: the checkout and order handlers, the webhook handlers, the provider's test mode, test accounts created for the pass, the data store
stop: an amount sent by the client is charged or stored as sent, or an unsigned webhook is accepted, which is a P0 and is reported before the pass continues
report: the price fields read from the request per handler, the tampered order results, the webhook signature results, the replay result read from the store, the return URL result, the card data search, and the reconciliation job

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
   Task: the model of the flow is in [payments.md](../payments.md). Confirm each handler checks the provider's signature, usually an HMAC over the raw body with a shared secret, compares it in constant time, and checks the timestamp window. Then send the handler a request with no signature, with a wrong one, and with a valid one over a modified body.
   Time: 30 minutes. Repository, plus running application.
   Result: all three rejected with their status codes, and the store unchanged after each, read from the store rather than from the response. The source also shows, with file references, that a verified event's amount and currency are compared with the local record before any state changes, and that an event for an unknown record or an unhandled type is answered 2xx and logged rather than acted on. The construction is in [payments.md](../payments.md#webhooks-received).

4. Make the handler idempotent.
   Task: replay a correctly signed event twice, and deliver two events for the same payment out of order.
   Time: 20 minutes. Running application, provider test mode only.
   Result: the store read after the replay shows one charge, one grant or one fulfilment, keyed on the provider's event identifier, stored in the same transaction as the state change, and the out-of-order pair leaves the record in the state the precedence rule in [payments.md](../payments.md#webhooks-received) gives, never in the state of whichever event arrived last. Every create or capture call the server makes to the provider carries an idempotency key derived from the order identifier, quoted from the source with a file reference.

5. Confirm the state against the provider, not against the client.
   Task: check that fulfilment, access grants and refunds are driven by the verified webhook or by a server-side call to the provider, never by a return URL or a client message saying the payment succeeded.
   Time: 20 minutes. Repository, plus running application.
   Result: a request to the success return URL with no completed payment grants nothing, recorded with the store read after it.

6. Keep card data off the servers and reconcile against the provider.
   Task: search the source, the schema and the logs for fields holding a card number, a security code or track data, and confirm the checkout uses hosted or provider-rendered fields. Then read the reconciliation job that compares orders against the provider's charges and payouts.
   Time: 25 minutes. Repository, plus the data store.
   Result: zero hits for stored card data, with the search expressions recorded, the checkout type named, and the reconciliation job's last run with the number of disagreements it flagged. A missing reconciliation job is a finding at P2.
