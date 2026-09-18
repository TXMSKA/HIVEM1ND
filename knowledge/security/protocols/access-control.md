name: access-control
purpose: Prove every object and every function checks the caller against the record.
trigger: manual, on any route, endpoint, server action, job or query that reads an identifier from the request
repeat: once per audit, and again whenever an endpoint is added or a role is changed
inputs: the route table, two accounts per role, a request client, the data store
stop: any request returns another account's data, which is a P0 and is reported before the pass continues
report: the endpoint table, the status code matrix of actor against endpoint, the property-level results, and the direct-request results for every server function

## Steps

1. Enumerate the surface before testing any of it.
   Task: list every route, API handler, server action, server function, scheduled job and subscription that accepts an identifier from the caller. Search the source for route and handler definitions rather than reading the documentation, which describes the intended surface and not the reachable one.
   Time: 30 minutes. Repository.
   Result: a table with path, method, the identifiers it reads, the roles meant to reach it, and where its check is written. An endpoint with no row for its check is already a finding.

2. Test object level authorization, every role against every endpoint.
   Task: with two accounts holding the same role, request each object belonging to the first while authenticated as the second, on every endpoint in the table. This is the first item on the API list because it is the failure that scales: one endpoint, every record.
   Time: 60 minutes. Running application.
   Result: a matrix row per actor and endpoint with the status code returned. Every cross-account request returns 403 or 404. The standard's own pass criterion is a test suite covering each role against each endpoint that fails the build, so the matrix is committed as tests rather than kept in the report.

3. Test function level authorization.
   Task: call every administrative and privileged endpoint as an ordinary user and as an anonymous caller, including the ones reached only from an administrative interface.
   Time: 30 minutes. Running application.
   Result: the status code per endpoint per actor, with no 2xx outside the role that owns it.

4. Test property level authorization in both directions.
   Task: on every write, send fields the role must not set, such as a role, an owner identifier, a price or a verification flag. On every read, list the fields the response actually returns per role.
   Time: 40 minutes. Running application, with a read against the data store.
   Result: the stored row read back after each write shows the extra field unchanged, taken from the store and not from the response. Plus the returned field list per role, with any field no role should see named as a finding.

5. Put the check inside the action, not on the page in front of it.
   Task: server actions and API handlers are routed endpoints reachable by a request built by hand, whatever the page that renders the form decided. Call each one directly, without loading the page. Middleware is a convenience layer and has been bypassed through a trusted internal header, as recorded in [framework-traps.md](../framework-traps.md).
   Time: 40 minutes. Running application, plus a repository search.
   Result: a direct request to each action returns the denial status for a caller that should not reach it, and the search for an action whose opening statements contain no authorization call returns zero hits.

6. Make the default a denial.
   Task: confirm that an unmatched path, an unknown method and a newly added endpoint with no explicit rule are all refused rather than allowed.
   Time: 20 minutes. Running application.
   Result: a temporary endpoint added with no rule returns 401 or 403, recorded with its status code, and is then removed.
