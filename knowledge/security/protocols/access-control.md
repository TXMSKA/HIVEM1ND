name: access-control
purpose: Prove every object and every function checks the caller against the record.
scope: routes, API handlers, server actions, jobs and queries that read an identifier or a role from the request
trigger: task close
repeat: once
inputs: the route table, two accounts per role as allowed by [rules-of-engagement.md](../rules-of-engagement.md#test-accounts), a request client, the data store
stop: any request returns another account's data, which is a P0, reported at once, and ends the protocol
report: the endpoint table, the status code matrix of actor against endpoint with its owner controls, the property-level results, and the direct-request results for every server function

## Steps

1. Enumerate the surface before testing any of it.
   Task: list every route, API handler, server action, server function, scheduled job and subscription that accepts an identifier from the caller, from the source rather than the documentation: `git grep -n -I -E '\.(get|post|put|patch|delete|all|route)\(|export (async )?function (GET|POST|PUT|PATCH|DELETE)|use server|@(Get|Post|Put|Patch|Delete)Mapping|@app\.(get|post|put|patch|delete|route)'`, adjusted to the router the stack uses, with a route known from the running application as the positive control. Where a machine-readable API description exists, compare it against the search, per [api-conventions.md](../api-conventions.md#a-description-that-cannot-drift).
   Time: 30 minutes. Repository.
   Result: a table with path, method, the identifiers it reads, the roles meant to reach it, and the file and line of its check. An endpoint with no check line is already a finding.

2. Test object level authorization, every role against every endpoint.
   Task: with two accounts holding the same role, request each object belonging to the first while authenticated as the second, on every endpoint in the table. First request the same object as its owner, which is the positive control for the denial.
   Time: 60 minutes. Running application.
   Result: a matrix row per actor and endpoint with the status code returned: 2xx for the owner, and 404 for every cross-account request, as [api-conventions.md](../api-conventions.md#status-codes-that-do-not-leak) sets out. The standard's own pass criterion is a test suite covering each role against each endpoint that fails the build; a project without one has a finding whose fix is that suite.

3. Test function level authorization.
   Task: call every administrative and privileged endpoint as an ordinary user and as an anonymous caller, including the ones reached only from an administrative interface, with the owning role's request as the positive control.
   Time: 30 minutes. Running application.
   Result: the status code per endpoint per actor, 401 for the anonymous caller and 403 for the ordinary user, with no 2xx outside the role that owns it.

4. Test property level authorization in both directions.
   Task: on every write, send fields the role must not set, such as a role, an owner identifier, a price or a verification flag. On every read, list the fields the response actually returns per role. From the repository, search for a whole body passed to an update: `git grep -n -I -E '(update|create|insert|save|assign)[A-Za-z]*\( *(req\.body|request\.body|body|data) *\)'`, with a planted `db.user.update(req.body)` as the positive control.
   Time: 40 minutes. Running application, with a read against the data store.
   Result: the stored row read back after each write showing the extra field unchanged, and the returned field list per role, with any field the view does not use, or no role should see, named as a finding. Zero whole bodies passed to an update. When no session is possible, the read direction runs from the repository: a handler that serializes a whole stored record, or a query selecting every column into the response, is a finding with its file and line.

5. Put the check inside the action, not on the page in front of it.
   Task: server actions and API handlers are routed endpoints reachable by a request built by hand, whatever the page that renders the form decided, and middleware has been bypassed, per [framework-traps.md](../framework-traps.md#authorization-skipped-through-a-trusted-internal-header). Call each one directly, without loading the page. Then read the opening statements of each: `git grep -n -I -A 6 -E 'use server|export (async )?function'` over the action files, counting the blocks that hold no call to the project's authorization function, with an action known to call it as the positive control.
   Time: 40 minutes. Running application, plus a repository search.
   Result: a direct request to each action returning the denial status for a caller that should not reach it, and zero action blocks without the authorization call, recorded with the expression and the name of the call searched.

6. Read the caller's identity from the session only.
   Task: search every route, handler and server action for an identity or a role read from the request: `git grep -n -I -E '(body|query|params|headers|searchParams|formData)[^;]{0,40}(userId|user_id|accountId|account_id|ownerId|owner_id|tenantId|tenant_id|isAdmin|is_admin|role)'`, with a planted `const id = req.body.userId` as the positive control. Identity comes from the session, per [sessions-and-credentials.md](../sessions-and-credentials.md#identity-comes-from-the-session).
   Time: 30 minutes. Repository, plus running application.
   Result: zero hits used to decide what the caller may do, and a request that sets another account's identifier in the body acting as the session's own account, read from the store.

7. Make the default a denial.
   Task: send a request to an unmatched path and with an unknown method, and read the router configuration for how a route with no explicit rule is treated. A temporary endpoint with no rule proves the default at runtime; it is a fixture written only as [rules-of-engagement.md](../rules-of-engagement.md#test-fixtures) sets out.
   Time: 20 minutes. Running application, plus the router configuration.
   Result: the unmatched path answering 404 and the unknown method 405, the router's default quoted with file and line, and, on the fixture branch, the temporary endpoint answering 401 or 403 before it is removed; without the yes for the fixture, that part is not run.
