name: queries-and-n-plus-one
purpose: Find the queries whose number grows with the data and the queries that are slow, fix them at the data layer, and keep the count from growing back.
scope: the data access behind an endpoint, a page or a job: SQL and document databases, ORMs, search indexes and stores read from files on each request
trigger: manual, on a slow endpoint, a slow list or a database under load, and task close for a change to a query, a model, a list endpoint or a store read per request
repeat: once per service, and again whenever a list endpoint or a model relation is added
inputs: a copy of the data with the size of the real one, the query log or slow query log, the ORM's logging, the database's plan command, the request log with timings
stop: the only data of real size is a person's or a customer's live data and no permission was given, in which case measurement runs on generated data of that size and says so; a fix changes an answer, in which case it is reverted and reported
report: the queries and time per endpoint before and after, each N+1 found with its counts at 1, 10 and 100 items, each slow query with its plan before and after, the longest lock hold, the 95th percentiles and the guard tests

## Steps

1. Log the queries per request.
   Task: turn on query logging with timing, through the ORM's logger, the database's statement log or a wrapper around the data layer that counts calls and time per request. For a store read from files, count the files opened and the bytes read per request.
   Time: 30 minutes.
   Result: for each endpoint, the number of queries or file reads of a typical request and their total time.

2. Find the N+1.
   Task: call every endpoint that returns a list with 1, 10 and 100 items and record the query count of each call.
   Time: 30 minutes.
   Result: a table of endpoint and query count at 1, 10 and 100 items, and every endpoint whose count grows with the items listed as an N+1.

3. Fix the N+1.
   Task: load the related data with the parent query: a join, an eager load of the relation, or one query with `IN` over the collected ids, batched per request as a data loader does. For a store read from files, read a directory once and index it, instead of opening a file per item.
   Time: 2 hours.
   Result: the query count of every endpoint from step 2 is the same at 1, 10 and 100 items, and the answers are byte for byte the same as before.

4. Find the slow queries.
   Task: list the queries above 100 ms from the slow query log, and the queries with the largest total time across requests. Run the database's plan command with execution statistics on each.
   Time: 30 minutes.
   Result: each slow query with its time and its plan, noting full scans, a missing index, a sort or a join spilled to disk, and the rows read against the rows returned.

5. Fix the slow queries.
   Task: add the index that matches the filter and the sort, select only the columns the caller uses, page with a key from the last row instead of a large offset, keep functions off indexed columns, move queries out of loops, and group writes into one transaction.
   Time: 2 hours.
   Result: the plan of each query uses the intended index, the rows read are close to the rows returned, and the time of each query before and after is recorded.

6. Shorten the locks.
   Task: find the transactions and locks held across file reads, network calls, full rescans or work for other requests, and move that work before or after the lock. Measure the longest hold and the time requests wait on it.
   Time: 1 hour; a service with no lock or long transaction ends this step as not applicable.
   Result: the longest lock hold and the longest wait before and after, and no network call or full rescan left inside a lock.

7. Measure the endpoints again.
   Task: run the endpoints of step 1 with the data of real size and record the median and the 95th percentile of each.
   Time: 30 minutes.
   Result: the 95th percentile of each endpoint before and after against the budget of [essentials.md](../essentials.md), Budgets, the gap stated where it is not met, and no endpoint slower than before.

8. Guard the counts.
   Task: add a test for each endpoint fixed in step 3 that asserts its query count with several items, so that a removed eager load fails it. Prove it by removing the fix locally and running the test.
   Time: 30 minutes.
   Result: each test passes with the fix, fails without it, and its name is in the report.
