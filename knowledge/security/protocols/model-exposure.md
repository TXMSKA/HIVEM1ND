name: model-exposure
purpose: Prove an injected instruction reaches nothing privileged, retrieval returns only what the caller may read, and spend has a hard ceiling.
scope: model calls, agents, tools, retrieval indexes, system prompts and generated output that reaches a user or a system
trigger: task close
repeat: once
inputs: the model call sites, the tool definitions, the retrieval sources and queries, the provider console read by the person, the browser network log, two test accounts
stop: a provider key is found in the client bundle, or a request goes from the page straight to the provider, which is a P0, reported at once, and ends the protocol
report: the key location per call site, the tool inventory with the privilege of each, the injection results recorded at the tool boundary, the spend ceilings with the behaviour at the ceiling, the output handling results, and the retrieval filter per query

## Steps

1. Keep the provider credential on the server.
   Task: run the build-output value search of [evidence.md](../evidence.md#searching-for-a-secret-value) for the provider key, and read the browser network log for requests going to a provider host. A request from the page directly to a model provider is a fail whatever the key's scope.
   Time: 20 minutes. Repository after a build, plus a browser.
   Result: `no match` for the key with its control, and a network log showing every model call leaving from the application's own origin.

2. Take state change away from the model.
   Task: prompt injection has no reliable prevention, so the defence is architectural. List every tool the model can call and what each one can change, with whose privileges. The model holds no credential of its own and calls no tool that changes state directly; it proposes, and a server-side handler with its own authorization decides.
   Time: 40 minutes. Repository.
   Result: a table of tool, what it reads, what it changes, the identity it runs as, and where its authorization check lives. Any tool running with more privilege than the requesting user is a finding; excessive agency is LLM03 of the OWASP Top 10 for LLM applications 2026, per [standards.md](../standards.md).

3. Put the person in front of the high impact actions.
   Task: for every action that spends money, sends a message, deletes data, changes a permission or touches a third party, show the literal action about to be taken and wait for a person. A summary of an action is not the action.
   Time: 30 minutes. Running application.
   Result: a capture per action class showing the exact parameters presented and the run halted until confirmation, plus a test where the confirmation is refused and nothing was written, read from the store.

4. Test injection, and grade it at the boundary rather than at the reply.
   Task: place instructions in every channel the model reads that a user or a third party controls: the message, an uploaded document, a retrieved page, a tool result, a file name, a database field. Include an instruction hidden by encoding or addressed to the model and not to the reader. Ask the injected instruction to call a privileged tool or reveal another user's data.
   Time: 60 minutes. Running application. Only against the application under test.
   Result: per channel, the tool call log and the credential boundary showing the injected instruction reached nothing privileged, as [evidence.md](../evidence.md#what-is-not-evidence) requires.

5. Treat the system prompt as public.
   Task: LLM08 Hidden Context Exposure of the 2026 list rests on the premise that the system prompt is discoverable, so no control may rest on its confidentiality. Read the system prompt and the tool descriptions for anything that is a control rather than an instruction: a key, an endpoint that is only secret, a rule that filters what a user may see.
   Time: 25 minutes. Repository.
   Result: the system prompt quoted with each item classified as instruction or control, and every control found named as a finding whose fix moves it into code.

6. Make the spend ceiling halt the work.
   Task: for every model or chat endpoint, a stub that calls no model yet included, read from the repository the input size cap, the output token cap passed on each call, the authentication or rate limit in front of it, and the spend counter. Read the token, request and currency ceilings per account, per session, per period and for the service, in the application and, through the person, at the provider. Proving that reaching a ceiling stops the work needs a deliberately low one: on a test build whose ceiling is lowered through its configuration, or as a fixture per [rules-of-engagement.md](../rules-of-engagement.md#test-fixtures).
   Time: 30 minutes. Repository, then running application.
   Result: the repository reading with file references, each missing cap a finding on its own, an oversized request rejected with its status code, and the run against the low ceiling halted, with the status returned to the caller; without such a build or fixture, that run is not run. Needs a person: what the ceilings should be.

7. Handle the output as untrusted input.
   Task: list the model call sites: `git grep -n -I -E 'completions\.create|messages\.create|responses\.create|generateText|streamText|generateContent|\.invoke\('`, with a call site known in the application as the positive control, and follow each output to the sinks of step 4 of [injection-and-output](injection-and-output.md), a query, a command or a file path.
   Time: 30 minutes. Repository, plus running application.
   Result: zero generated values reaching a raw insertion sink, a query string or a command, and a test where the model is induced to emit markup showing it rendered as text, with the capture.

8. Filter retrieval by the caller before the model sees it.
   Task: read each retrieval query, such as a vector search, a full-text search or a file search a tool performs: the owner or tenant filter taken from the session is part of the query itself, never applied to the results afterwards or left to the model, documents carry their owner when indexed, and a deleted or unshared record leaves the index. Then, as the second test account, ask for the content of a document only the first one owns, by its title and by a phrase from it, and delete a document as the first account and ask again.
   Time: 30 minutes. Repository, plus running application with two test accounts.
   Result: the filter quoted from each query with file and line, zero queries without one, the retrieved chunk list read from the tool call log holding none of the first account's content for the second, and the deleted document absent from the next retrieval. Without retrieval, not applicable.
