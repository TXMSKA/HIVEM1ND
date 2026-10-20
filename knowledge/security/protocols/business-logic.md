name: business-logic
purpose: Prove a single-use or bounded value is spent once even under concurrent requests, a multi-step flow cannot be skipped or reordered, and the numbers a caller sends cannot bend the rules of the business.
scope: vouchers, gift cards, credits, balances, stock, seats, quotas, invitations and other single-use values, multi-step flows such as checkout, onboarding and approval, and handlers that read a record and then write it
trigger: task close
repeat: once
inputs: the handlers that spend or move a bounded value, the flow definitions, two test accounts, a request client that sends requests in parallel, the test store
stop: a single-use value is spent twice or a balance passes its floor, which is reported at once and ends the protocol
report: the bounded values with their guard, the concurrency results read from the store, the step order results, and the numeric bound results

## Steps

1. List what can be spent only once or within a bound.
   Task: search the handlers for writes that redeem, consume, decrement or transfer: `git grep -n -I -i -E 'redeem|consume|decrement|balance|credits?|stock|remaining|seats?|quota|is_?used|used_?at|claimed'`, with a planted `voucher.redeem(code)` as the positive control. For each value, read its guard: a conditional update from the expected state, a unique constraint, a row lock, or none.
   Time: 30 minutes. Repository.
   Result: a table of value, handler, guard and file and line. A read followed by a separate write with no guard is a finding.

2. Spend each value at the same instant from parallel requests.
   Task: with a test account in the test store, send the same redemption, transfer or purchase as 10 parallel requests: Unix shell `seq 10 | xargs -P 10 -I{} curl -s -o /dev/null -w '%{http_code}\n' <request>`, PowerShell 7 `1..10 | ForEach-Object -Parallel { curl.exe -s -o NUL -w '%{http_code}' <request> } -ThrottleLimit 10`; Windows PowerShell 5.1 has no `-Parallel`, so there the Unix form runs from a Unix-style shell. Ten is the ceiling of this test, which keeps it a proof and not a load test, per [rules-of-engagement.md](../rules-of-engagement.md#what-a-pass-may-never-do).
   Time: 30 minutes. Running application, test store only.
   Result: the ten status codes and the store read after them showing one effect, such as one redemption or one decrease of the balance, with the other requests refused.

3. Skip and reorder the steps of each multi-step flow.
   Task: for each flow with more than one request, such as checkout, onboarding, approval or an invitation, call the last step without the earlier ones, repeat a completed step, and send the steps out of order.
   Time: 30 minutes. Running application.
   Result: per flow, each out-of-order request refused with its status code and the store unchanged, the flow state being held on the server.

4. Send the numbers the business does not allow.
   Task: send negative, zero, fractional, very large and overflowing values, and values that round at the half, to every quantity, count, duration and seat number a caller sets. Prices and amounts are covered by step 2 of [payments-and-webhooks](payments-and-webhooks.md).
   Time: 20 minutes. Running application.
   Result: per field the status code and the stored row, with no negative balance, no free item and no rounding in the caller's favour.
